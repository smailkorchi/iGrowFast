import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import {
    Search,
    User,
    Phone,
    MapPin,
    ShoppingBag,
    CreditCard,
    Calendar,
    ArrowUpRight,
    TrendingUp,
    Filter,
    Download,
    ChevronsUpDown,
    X,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Users as UsersIcon,
    DollarSign,
    Activity,
    Truck
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from '@/lib/utils';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
    Cell
} from 'recharts';
import { format } from 'date-fns';

function formatStatusCategoryLabel(category: string) {
    return category
        .split(/[_\s]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

// --- Types ---

interface Order {
    id: string;
    date: string;
    price: number;
    shipping_cost: number;
    order_status_id: string;
    package_status_id: string | null;
    package_status_label?: string | null;
    package_statuses?: { label?: string | null } | null;
    status: {
        label: string;
        color: string;
    };
    city_name: string;
}

interface Customer {
    id: string; // phone as unique id
    name: string;
    phone: string;
    city: string;
    totalOrders: number;
    totalSpent: number;
    lastOrderDate: string;
    firstOrderDate: string;
    orders: Order[];
    avgOrderValue: number;
    status: 'High Value' | 'Mid Value' | 'Low Value' | 'New';
    interactionScore: number; // calculated score
}

const PAGE_SIZE = 12;

const Customers = () => {
    const statusCats = useStatusCategories();
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
    const [sortBy, setSortBy] = useState<'recency' | 'value' | 'frequency'>('recency');
    const [orderStatusFilterIds, setOrderStatusFilterIds] = useState<string[]>([]);
    const [packageStatusFilterIds, setPackageStatusFilterIds] = useState<string[]>([]);
    const [orderStatusFilterOpen, setOrderStatusFilterOpen] = useState(false);
    const [packageStatusFilterOpen, setPackageStatusFilterOpen] = useState(false);
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const orderStatusGroups = useMemo(() => {
        const list = statusCats.orderStatuses.filter((s) => s.active !== false);
        const catOrder = [...new Set(list.map((s) => s.category))];
        return catOrder.map((cat) => ({
            category: cat,
            heading: formatStatusCategoryLabel(cat),
            items: list
                .filter((s) => s.category === cat)
                .sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0)),
        }));
    }, [statusCats.orderStatuses]);

    const packageStatusGroups = useMemo(() => {
        const list = statusCats.packageStatuses;
        const catOrder = [...new Set(list.map((s) => s.category))];
        return catOrder.map((cat) => ({
            category: cat,
            heading: formatStatusCategoryLabel(cat),
            items: list
                .filter((s) => s.category === cat)
                .sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0)),
        }));
    }, [statusCats.packageStatuses]);

    const toggleOrderStatusFilter = (id: string) => {
        setOrderStatusFilterIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    const togglePackageStatusFilter = (id: string) => {
        setPackageStatusFilterIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );
    };

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, sortBy, orderStatusFilterIds, packageStatusFilterIds]);

    // --- Data Fetching ---
    const { data: customers, isLoading } = useQuery({
        queryKey: ['customers-derived', activeBusinessId, statusCats.confirmedIds.size, statusCats.deliveredPkgIds.size],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            // Fetch all orders with necessary fields
            const { data: orders, error } = await supabase
                .from('orders')
                .select(`
                    id,
                    name,
                    phone,
                    address,
                    price,
                    shipping_cost,
                    date,
                    created_at,
                    order_status_id,
                    package_status_id,
                    package_status_label,
                    city:master_cities(name),
                    status:order_statuses(label, color),
                    package_statuses(label)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .is('date_deleted', null)
                .order('date', { ascending: false });

            if (error) throw error;

            // Aggregation map
            const customerMap = new Map<string, Customer>();

            orders?.forEach((order: any) => {
                const phone = order.phone?.replace(/[^0-9]/g, ''); // Normalize phone
                if (!phone) return;

                const orderPrice = Number(order.price) || 0;
                const orderDate = order.date || order.created_at;

                // master_cities returns an object or array depending on the relation. It's usually a single object.
                const cityName = (order.city as any)?.name || 'Unknown';
                const statusLabel = order.status?.label || 'Unknown';
                const statusColor = order.status?.color || '#000';

                const orderObj: Order = {
                    id: order.id,
                    date: orderDate,
                    price: orderPrice,
                    shipping_cost: Number(order.shipping_cost) || 0,
                    order_status_id: order.order_status_id || '',
                    package_status_id: order.package_status_id || null,
                    package_status_label: order.package_status_label ?? null,
                    package_statuses: (order as any).package_statuses ?? null,
                    status: { label: statusLabel, color: statusColor },
                    city_name: cityName
                };

                if (customerMap.has(phone)) {
                    const cust = customerMap.get(phone)!;
                    cust.orders.push(orderObj);
                    cust.totalOrders += 1;
                    cust.totalSpent += orderPrice;
                    cust.name = order.name || cust.name; // Keep latest name
                    cust.city = cityName !== 'Unknown' ? cityName : cust.city;
                    // Dates handled by sorting orders later
                } else {
                    customerMap.set(phone, {
                        id: phone,
                        name: order.name || 'Unknown',
                        phone: phone,
                        city: cityName,
                        totalOrders: 1,
                        totalSpent: orderPrice,
                        lastOrderDate: orderDate, // Initial
                        firstOrderDate: orderDate, // Initial
                        orders: [orderObj],
                        avgOrderValue: 0,
                        status: 'New',
                        interactionScore: 0
                    });
                }
            });

            // Post-processing
            const processedCustomers = Array.from(customerMap.values()).map(cust => {
                // Sort orders by date desc
                cust.orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                cust.lastOrderDate = cust.orders[0].date;
                cust.firstOrderDate = cust.orders[cust.orders.length - 1].date;
                cust.avgOrderValue = cust.totalSpent / cust.totalOrders;

                // Determine Status based on simple rules (customize as needed)
                if (cust.totalSpent > 1000) cust.status = 'High Value';
                else if (cust.totalSpent > 500) cust.status = 'Mid Value';
                else cust.status = 'Low Value';

                // Interaction Score (successful = confirmed+delivered)
                const successfulOrders = cust.orders.filter(o =>
                    statusCats.confirmedIds.has(o.order_status_id) &&
                    isDeliveredForCommission(o, statusCats.deliveredPkgIds)
                ).length;
                cust.interactionScore = (successfulOrders * 10) + (cust.totalOrders * 2);

                return cust;
            });

            return processedCustomers;
        }
    });

    // --- Filtering & Sorting ---
    const filteredData = useMemo(() => {
        if (!customers) return [];

        const pkgList = statusCats.packageStatuses;
        const orderSel = new Set(orderStatusFilterIds);
        const pkgSel = new Set(packageStatusFilterIds);

        const orderMatchesFilter = (o: Order) =>
            orderStatusFilterIds.length === 0 || orderSel.has(o.order_status_id);

        const packageMatchesFilter = (o: Order) => {
            if (packageStatusFilterIds.length === 0) return true;
            if (o.package_status_id && pkgSel.has(o.package_status_id)) return true;
            const label = (o.package_status_label || o.package_statuses?.label || '').trim();
            if (!label) return false;
            return pkgList.some((ps) => pkgSel.has(ps.id) && ps.label === label);
        };

        let res = customers.filter((c) => {
            const passesOrder =
                orderStatusFilterIds.length === 0 || c.orders.some(orderMatchesFilter);
            const passesPkg =
                packageStatusFilterIds.length === 0 || c.orders.some(packageMatchesFilter);
            return passesOrder && passesPkg;
        });

        res = res.filter(
            (c) =>
                c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                c.phone.includes(searchQuery) ||
                c.city.toLowerCase().includes(searchQuery.toLowerCase())
        );

        if (sortBy === 'recency') {
            res.sort((a, b) => new Date(b.lastOrderDate).getTime() - new Date(a.lastOrderDate).getTime());
        } else if (sortBy === 'value') {
            res.sort((a, b) => b.totalSpent - a.totalSpent);
        } else if (sortBy === 'frequency') {
            res.sort((a, b) => b.totalOrders - a.totalOrders);
        }

        return res;
    }, [
        customers,
        searchQuery,
        sortBy,
        orderStatusFilterIds,
        packageStatusFilterIds,
        statusCats.packageStatuses,
    ]);

    const paginatedCustomers = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredData.slice(start, start + PAGE_SIZE);
    }, [filteredData, currentPage]);

    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

    // --- Stats ---
    const stats = useMemo(() => {
        if (!customers) return { total: 0, revenue: 0, avgValue: 0 };
        const total = customers.length;
        const revenue = customers.reduce((acc, c) => acc + c.totalSpent, 0);
        return {
            total,
            revenue,
            avgValue: total ? revenue / total : 0
        };
    }, [customers]);

    // --- Chart Data for Selected Customer ---
    const chartData = useMemo(() => {
        if (!selectedCustomer) return [];
        // Aggregate by date (or just list orders)
        // Let's reverse for chronological order
        return [...selectedCustomer.orders].reverse().map(o => ({
            date: format(new Date(o.date), 'MMM dd'),
            amount: o.price,
            fullDate: o.date
        }));
    }, [selectedCustomer]);


    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Customers</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Customer base &amp; insights</p>
                    </div>
                    <Button variant="outline" className="h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 border-gray-200 shrink-0">
                        <Download className="w-3.5 h-3.5" />
                        Export
                    </Button>
                </div>
            </header>

            {/* KPI tiles */}
            {isLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {[1,2,3].map(i => <div key={i} className="rounded-xl border border-gray-100 bg-white h-[62px] animate-pulse" />)}
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {[
                        { label: 'Total customers', value: stats.total.toLocaleString(), accent: '#3b5e5e' },
                        { label: 'Total lifetime value', value: `${stats.revenue.toLocaleString()} MAD`, accent: '#059669' },
                        { label: 'Avg. customer value', value: `${stats.avgValue.toFixed(0)} MAD`, accent: '#d97706' },
                    ].map((s) => (
                        <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                            <span className="w-[3px] self-stretch rounded-full" style={{ background: s.accent }} />
                            <div className="flex-1 min-w-0">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 truncate">{s.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Controls */}
            <div className="space-y-2">
                <div className="flex flex-col xl:flex-row gap-2 items-stretch xl:items-center justify-between">
                    <div className="relative w-full xl:w-72 shrink-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                        <Input
                            placeholder="Search by name, phone, city..."
                            className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px]"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full xl:flex-1 xl:justify-end">
                        <Popover open={orderStatusFilterOpen} onOpenChange={setOrderStatusFilterOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(
                                        'h-8 rounded-md border-gray-200 justify-between gap-1.5 text-[11px] font-semibold text-brand-navy sm:min-w-[160px]',
                                        orderStatusFilterIds.length > 0 && 'border-brand-navy/30 bg-brand-navy/[0.04]'
                                    )}
                                >
                                    <span className="flex items-center gap-1.5 truncate">
                                        <ShoppingBag className="w-3 h-3 shrink-0 opacity-60" />
                                        <span className="truncate">
                                            {orderStatusFilterIds.length === 0
                                                ? 'Order status'
                                                : `${orderStatusFilterIds.length} order status${orderStatusFilterIds.length > 1 ? 'es' : ''}`}
                                        </span>
                                    </span>
                                    <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                className="w-[min(100vw-2rem,380px)] p-0 rounded-2xl border border-brand-navy/10 shadow-xl"
                                align="end"
                                onWheel={(e) => e.stopPropagation()}
                            >
                                <Command className="rounded-2xl">
                                    <CommandInput placeholder="Search order statuses…" className="h-11" />
                                    <CommandList className="max-h-[min(55vh,300px)]">
                                        <CommandEmpty>No matching status.</CommandEmpty>
                                        {orderStatusGroups.map((g) => (
                                            <CommandGroup key={g.category} heading={g.heading}>
                                                {g.items.map((s) => (
                                                    <CommandItem
                                                        key={s.id}
                                                        value={`${s.label} ${g.category}`}
                                                        onSelect={() => toggleOrderStatusFilter(s.id)}
                                                        className="flex cursor-pointer items-center gap-2 aria-selected:bg-brand-navy/5"
                                                    >
                                                        <Checkbox
                                                            checked={orderStatusFilterIds.includes(s.id)}
                                                            className="pointer-events-none border-brand-navy/30 data-[state=checked]:bg-brand-navy data-[state=checked]:border-brand-navy"
                                                        />
                                                        <span
                                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                            style={{
                                                                backgroundColor: s.color || '#94a3b8',
                                                            }}
                                                        />
                                                        <span className="font-medium text-brand-navy">{s.label}</span>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        ))}
                                    </CommandList>
                                </Command>
                                <div className="flex items-center justify-between gap-2 border-t border-brand-navy/10 px-3 py-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs font-bold text-muted-foreground"
                                        onClick={() => setOrderStatusFilterIds([])}
                                    >
                                        Clear all
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs font-bold text-brand-navy"
                                        onClick={() => setOrderStatusFilterOpen(false)}
                                    >
                                        Done
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>

                        <Popover open={packageStatusFilterOpen} onOpenChange={setPackageStatusFilterOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(
                                        'h-8 rounded-md border-gray-200 justify-between gap-1.5 text-[11px] font-semibold text-brand-navy sm:min-w-[160px]',
                                        packageStatusFilterIds.length > 0 && 'border-brand-navy/30 bg-brand-navy/[0.04]'
                                    )}
                                >
                                    <span className="flex items-center gap-1.5 truncate">
                                        <Truck className="w-3 h-3 shrink-0 opacity-60" />
                                        <span className="truncate">
                                            {packageStatusFilterIds.length === 0
                                                ? 'Package status'
                                                : `${packageStatusFilterIds.length} package status${packageStatusFilterIds.length > 1 ? 'es' : ''}`}
                                        </span>
                                    </span>
                                    <ChevronsUpDown className="w-3 h-3 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                className="w-[min(100vw-2rem,380px)] p-0 rounded-2xl border border-brand-navy/10 shadow-xl"
                                align="end"
                                onWheel={(e) => e.stopPropagation()}
                            >
                                <Command className="rounded-2xl">
                                    <CommandInput placeholder="Search package statuses…" className="h-11" />
                                    <CommandList className="max-h-[min(55vh,300px)]">
                                        <CommandEmpty>No matching status.</CommandEmpty>
                                        {packageStatusGroups.map((g) => (
                                            <CommandGroup key={g.category} heading={g.heading}>
                                                {g.items.map((s) => (
                                                    <CommandItem
                                                        key={s.id}
                                                        value={`${s.label} ${g.category}`}
                                                        onSelect={() => togglePackageStatusFilter(s.id)}
                                                        className="flex cursor-pointer items-center gap-2 aria-selected:bg-brand-navy/5"
                                                    >
                                                        <Checkbox
                                                            checked={packageStatusFilterIds.includes(s.id)}
                                                            className="pointer-events-none border-brand-navy/30 data-[state=checked]:bg-brand-navy data-[state=checked]:border-brand-navy"
                                                        />
                                                        <span
                                                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                            style={{
                                                                backgroundColor: s.color || '#94a3b8',
                                                            }}
                                                        />
                                                        <span className="font-medium text-brand-navy">{s.label}</span>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        ))}
                                    </CommandList>
                                </Command>
                                <div className="flex items-center justify-between gap-2 border-t border-brand-navy/10 px-3 py-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs font-bold text-muted-foreground"
                                        onClick={() => setPackageStatusFilterIds([])}
                                    >
                                        Clear all
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-xs font-bold text-brand-navy"
                                        onClick={() => setPackageStatusFilterOpen(false)}
                                    >
                                        Done
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>

                        {(orderStatusFilterIds.length > 0 || packageStatusFilterIds.length > 0) && (
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-8 rounded-md text-[11px] font-semibold text-brand-navy/80 hover:text-brand-navy"
                                onClick={() => {
                                    setOrderStatusFilterIds([]);
                                    setPackageStatusFilterIds([]);
                                }}
                            >
                                <X className="w-3 h-3 mr-1" />
                                Reset
                            </Button>
                        )}

                        <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                            <SelectTrigger className="w-full sm:w-[150px] h-8 rounded-md border-gray-200 text-[11px]">
                                <div className="flex items-center gap-1.5">
                                    <Filter className="w-3 h-3 opacity-50" />
                                    <SelectValue placeholder="Sort by" />
                                </div>
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="recency">Most Recent</SelectItem>
                                <SelectItem value="value">Highest Value</SelectItem>
                                <SelectItem value="frequency">Most Orders</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                {customers && filteredData.length !== customers.length && (
                    <p className="text-[10px] font-medium text-gray-400 px-1">
                        Showing{' '}
                        <span className="font-bold text-brand-navy">{filteredData.length}</span> of{' '}
                        {customers.length} customers
                    </p>
                )}
            </div>

            {/* Customer Table */}
            {isLoading ? (
                <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />)}</div>
            ) : paginatedCustomers.length === 0 ? (
                <div className="border border-dashed border-gray-200 rounded-xl py-8 text-center">
                    <p className="text-[14px] font-semibold text-brand-navy">No customers found</p>
                    <p className="text-[11px] text-gray-400 mt-1">Try adjusting search or filters.</p>
                </div>
            ) : (
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-gray-100">
                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Customer</th>
                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">City</th>
                                <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Orders</th>
                                <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Spent</th>
                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Last order</th>
                                <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Status</th>
                                <th className="px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                        {paginatedCustomers.map((customer) => (
                            <tr
                                key={customer.id}
                                className="hover:bg-gray-50 transition-colors border-b border-gray-100 cursor-pointer"
                                onClick={() => setSelectedCustomer(customer)}
                            >
                                <td className="px-3 py-2">
                                    <div className="flex items-center gap-2">
                                        <div className="h-7 w-7 rounded-full bg-brand-navy/5 flex items-center justify-center text-brand-navy font-bold text-[11px] shrink-0">
                                            {customer.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[12px] font-semibold text-brand-navy leading-tight truncate">{customer.name}</p>
                                            <p className="text-[10px] text-gray-500 font-mono">{customer.phone}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-3 py-2 text-[11px] text-brand-navy/80">{customer.city}</td>
                                <td className="px-3 py-2 text-right text-[11px] text-brand-navy/80 tabular-nums font-semibold">{customer.totalOrders}</td>
                                <td className="px-3 py-2 text-right text-[11px] text-brand-navy font-semibold tabular-nums">{customer.totalSpent.toLocaleString()} dh</td>
                                <td className="px-3 py-2 text-[10px] text-gray-500 tabular-nums">{format(new Date(customer.lastOrderDate), 'MMM d, yyyy')}</td>
                                <td className="px-3 py-2">
                                    {customer.orders[0]?.status?.label && (
                                        <span
                                            className="inline-flex items-center h-5 px-1.5 rounded text-[9px] font-bold uppercase tracking-[0.08em]"
                                            style={{ backgroundColor: `${customer.orders[0].status.color}20`, color: customer.orders[0].status.color }}
                                        >
                                            {customer.orders[0].status.label}
                                        </span>
                                    )}
                                </td>
                                <td className="px-3 py-2">
                                    <ArrowUpRight className="w-3.5 h-3.5 text-gray-300" />
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            </div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="h-8 w-8 rounded-md border-gray-200"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <span className="text-[11px] font-semibold text-brand-navy px-2">
                        {currentPage} / {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="h-8 w-8 rounded-md border-gray-200"
                    >
                        <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                </div>
            )}

            {/* Customer detail dialog */}
            <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-gray-100 shadow-none p-0 gap-0">
                    {selectedCustomer && (
                        <div className="p-4 space-y-3">
                            {/* Identity */}
                            <div className="flex items-center gap-3 pb-3 border-b border-gray-100">
                                <div className="h-7 w-7 rounded-full bg-brand-navy/5 flex items-center justify-center text-brand-navy font-bold text-[11px] shrink-0">
                                    {selectedCustomer.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-semibold text-brand-navy leading-none truncate">{selectedCustomer.name}</p>
                                    <p className="text-[10px] text-gray-500 mt-0.5 font-mono">{selectedCustomer.phone} · {selectedCustomer.city}</p>
                                </div>
                                <span className={cn(
                                    "h-5 px-1.5 rounded text-[9px] font-bold uppercase tracking-[0.08em] inline-flex items-center",
                                    selectedCustomer.status === 'High Value' ? "bg-amber-50 text-amber-600" :
                                    selectedCustomer.status === 'Mid Value' ? "bg-brand-navy/10 text-brand-navy" :
                                    "bg-gray-100 text-gray-500"
                                )}>
                                    {selectedCustomer.status}
                                </span>
                            </div>

                            {/* KPI row */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    { label: 'Lifetime value', value: `${selectedCustomer.totalSpent.toLocaleString()} dh`, accent: '#059669' },
                                    { label: 'Total orders', value: String(selectedCustomer.totalOrders), accent: '#3b5e5e' },
                                    { label: 'Avg. order', value: `${selectedCustomer.avgOrderValue.toFixed(0)} dh`, accent: '#d97706' },
                                    { label: 'Score', value: String(selectedCustomer.interactionScore), accent: '#3b5e5e' },
                                ].map((s) => (
                                    <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2">
                                        <span className="w-[3px] self-stretch rounded-full" style={{ background: s.accent }} />
                                        <div>
                                            <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                                            <p className="text-[15px] font-semibold tabular-nums text-brand-navy mt-0.5">{s.value}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Chart */}
                            <div className="rounded-xl border border-gray-100 bg-white p-3">
                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400 mb-2">Order amount history</p>
                                <div className="h-[180px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#3b5e5e" stopOpacity={0.08} />
                                                    <stop offset="95%" stopColor="#3b5e5e" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} dy={6} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 9 }} tickFormatter={(v) => `${v}dh`} />
                                            <CartesianGrid vertical={false} stroke="#f3f4f6" strokeDasharray="3 3" />
                                            <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #f3f4f6', fontSize: '11px' }} cursor={{ stroke: '#9ca3af', strokeWidth: 1 }} />
                                            <Area type="monotone" dataKey="amount" stroke="#3b5e5e" strokeWidth={1.5} fillOpacity={1} fill="url(#colorAmount)" activeDot={{ r: 4, strokeWidth: 0, fill: '#3b5e5e' }} />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Orders table */}
                            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-gray-100">
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Date</th>
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Status</th>
                                            <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">City</th>
                                            <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedCustomer.orders.map((order) => (
                                            <tr key={order.id} className="hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                                                <td className="px-3 py-2 text-[10px] text-gray-500 tabular-nums">{format(new Date(order.date), 'MMM d, yyyy')}</td>
                                                <td className="px-3 py-2">
                                                    <span
                                                        className="h-5 px-1.5 rounded text-[9px] font-bold uppercase tracking-[0.08em] inline-flex items-center"
                                                        style={{ backgroundColor: `${order.status.color}20`, color: order.status.color }}
                                                    >
                                                        {order.status.label}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-[11px] text-brand-navy/80">{order.city_name}</td>
                                                <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums">{order.price.toLocaleString()} dh</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Customers;
