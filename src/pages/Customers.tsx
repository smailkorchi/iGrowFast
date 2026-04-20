import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { isDeliveredForCommission } from '@/lib/commercialCommission';
import {
    Search,
    ShoppingBag,
    ArrowUpRight,
    Filter,
    Download,
    ChevronsUpDown,
    X,
    ChevronLeft,
    ChevronRight,
    Users as UsersIcon,
    Coins,
    TrendingUp,
    Truck,
    Activity,
    type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
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
import { cn } from '@/lib/utils';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
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
    id: string;
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
    interactionScore: number;
}

const PAGE_SIZE = 12;

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const CustomerKpi: React.FC<{
    label: string;
    value: string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const valueTierPill = (status: Customer['status']) => {
    if (status === 'High Value') return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green' };
    if (status === 'Mid Value') return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange' };
    if (status === 'New') return { bg: 'bg-ant-ink/5', border: 'border-ant-line', text: 'text-ant-ink', dot: 'bg-ant-ink' };
    return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid' };
};

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
            items: list.filter((s) => s.category === cat).sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0)),
        }));
    }, [statusCats.orderStatuses]);

    const packageStatusGroups = useMemo(() => {
        const list = statusCats.packageStatuses;
        const catOrder = [...new Set(list.map((s) => s.category))];
        return catOrder.map((cat) => ({
            category: cat,
            heading: formatStatusCategoryLabel(cat),
            items: list.filter((s) => s.category === cat).sort((a, b) => (a.ranking ?? 0) - (b.ranking ?? 0)),
        }));
    }, [statusCats.packageStatuses]);

    const toggleOrderStatusFilter = (id: string) => {
        setOrderStatusFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const togglePackageStatusFilter = (id: string) => {
        setPackageStatusFilterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, sortBy, orderStatusFilterIds, packageStatusFilterIds]);

    const { data: customers, isLoading } = useQuery({
        queryKey: ['customers-derived', activeBusinessId, statusCats.confirmedIds.size, statusCats.deliveredPkgIds.size],
        queryFn: async () => {
            if (!activeBusinessId) return [];
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

            const customerMap = new Map<string, Customer>();

            orders?.forEach((order: any) => {
                const phone = order.phone?.replace(/[^0-9]/g, '');
                if (!phone) return;

                const orderPrice = Number(order.price) || 0;
                const orderDate = order.date || order.created_at;

                const cityName = (order.city as any)?.name || 'Unknown';
                const statusLabel = order.status?.label || 'Unknown';
                const statusColor = order.status?.color || '#D97706';

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
                    city_name: cityName,
                };

                if (customerMap.has(phone)) {
                    const cust = customerMap.get(phone)!;
                    cust.orders.push(orderObj);
                    cust.totalOrders += 1;
                    cust.totalSpent += orderPrice;
                    cust.name = order.name || cust.name;
                    cust.city = cityName !== 'Unknown' ? cityName : cust.city;
                } else {
                    customerMap.set(phone, {
                        id: phone,
                        name: order.name || 'Unknown',
                        phone: phone,
                        city: cityName,
                        totalOrders: 1,
                        totalSpent: orderPrice,
                        lastOrderDate: orderDate,
                        firstOrderDate: orderDate,
                        orders: [orderObj],
                        avgOrderValue: 0,
                        status: 'New',
                        interactionScore: 0,
                    });
                }
            });

            const processedCustomers = Array.from(customerMap.values()).map((cust) => {
                cust.orders.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                cust.lastOrderDate = cust.orders[0].date;
                cust.firstOrderDate = cust.orders[cust.orders.length - 1].date;
                cust.avgOrderValue = cust.totalSpent / cust.totalOrders;

                if (cust.totalSpent > 1000) cust.status = 'High Value';
                else if (cust.totalSpent > 500) cust.status = 'Mid Value';
                else cust.status = 'Low Value';

                const successfulOrders = cust.orders.filter(
                    (o) =>
                        statusCats.confirmedIds.has(o.order_status_id) &&
                        isDeliveredForCommission(o, statusCats.deliveredPkgIds)
                ).length;
                cust.interactionScore = successfulOrders * 10 + cust.totalOrders * 2;

                return cust;
            });

            return processedCustomers;
        },
    });

    const filteredData = useMemo(() => {
        if (!customers) return [];

        const pkgList = statusCats.packageStatuses;
        const orderSel = new Set(orderStatusFilterIds);
        const pkgSel = new Set(packageStatusFilterIds);

        const orderMatchesFilter = (o: Order) => orderStatusFilterIds.length === 0 || orderSel.has(o.order_status_id);

        const packageMatchesFilter = (o: Order) => {
            if (packageStatusFilterIds.length === 0) return true;
            if (o.package_status_id && pkgSel.has(o.package_status_id)) return true;
            const label = (o.package_status_label || o.package_statuses?.label || '').trim();
            if (!label) return false;
            return pkgList.some((ps) => pkgSel.has(ps.id) && ps.label === label);
        };

        let res = customers.filter((c) => {
            const passesOrder = orderStatusFilterIds.length === 0 || c.orders.some(orderMatchesFilter);
            const passesPkg = packageStatusFilterIds.length === 0 || c.orders.some(packageMatchesFilter);
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
    }, [customers, searchQuery, sortBy, orderStatusFilterIds, packageStatusFilterIds, statusCats.packageStatuses]);

    const paginatedCustomers = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return filteredData.slice(start, start + PAGE_SIZE);
    }, [filteredData, currentPage]);

    const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);

    const stats = useMemo(() => {
        if (!customers) return { total: 0, revenue: 0, avgValue: 0 };
        const total = customers.length;
        const revenue = customers.reduce((acc, c) => acc + c.totalSpent, 0);
        return {
            total,
            revenue,
            avgValue: total ? revenue / total : 0,
        };
    }, [customers]);

    const chartData = useMemo(() => {
        if (!selectedCustomer) return [];
        return [...selectedCustomer.orders].reverse().map((o) => ({
            date: format(new Date(o.date), 'MMM dd'),
            amount: o.price,
            fullDate: o.date,
        }));
    }, [selectedCustomer]);

    return (
        <div className="ant-surface min-h-screen">
            <div className="mx-auto max-w-[1440px] px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            People · Lifetime ledger
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Customers
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every phone number becomes a story — the first order, the loyalty, the value accrued across every return.
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        className="h-10 px-5 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Download className="w-3.5 h-3.5" />
                        Export
                    </Button>
                </header>

                {/* KPI strip */}
                {isLoading ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4 animate-pulse h-[100px]" />
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <CustomerKpi label="Total customers" value={stats.total.toLocaleString()} suffix="profiles" accent="ink" icon={UsersIcon} />
                        <CustomerKpi label="Lifetime value" value={Math.round(stats.revenue).toLocaleString()} suffix="MAD" accent="green" icon={TrendingUp} />
                        <CustomerKpi label="Avg. customer value" value={Math.round(stats.avgValue).toLocaleString()} suffix="MAD" accent="orange" icon={Coins} />
                    </section>
                )}

                {/* Toolbar */}
                <div className="space-y-2">
                    <div className="flex flex-col xl:flex-row gap-2 items-stretch xl:items-center justify-between">
                        <div className="relative w-full xl:w-[320px] shrink-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                            <Input
                                placeholder="Search by name, phone, city..."
                                className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
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
                                            'h-10 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light justify-between gap-2 text-[12px] font-semibold text-ant-ink sm:min-w-[170px]',
                                            orderStatusFilterIds.length > 0 && 'border-ant-orange/40 bg-ant-orange/5'
                                        )}
                                    >
                                        <span className="flex items-center gap-2 truncate">
                                            <ShoppingBag className="w-3.5 h-3.5 text-ant-mid" />
                                            <span className="truncate">
                                                {orderStatusFilterIds.length === 0
                                                    ? 'Order status'
                                                    : `${orderStatusFilterIds.length} order status${orderStatusFilterIds.length > 1 ? 'es' : ''}`}
                                            </span>
                                        </span>
                                        <ChevronsUpDown className="w-3 h-3 text-ant-mid" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-[min(100vw-2rem,380px)] p-0 rounded-2xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]"
                                    align="end"
                                    onWheel={(e) => e.stopPropagation()}
                                >
                                    <Command className="rounded-2xl">
                                        <CommandInput placeholder="Search order statuses…" className="h-11" />
                                        <CommandList className="max-h-[min(55vh,300px)]">
                                            <CommandEmpty className="text-[12px] text-ant-mid py-4 font-serif italic">No matching status.</CommandEmpty>
                                            {orderStatusGroups.map((g) => (
                                                <CommandGroup key={g.category} heading={g.heading}>
                                                    {g.items.map((s) => (
                                                        <CommandItem
                                                            key={s.id}
                                                            value={`${s.label} ${g.category}`}
                                                            onSelect={() => toggleOrderStatusFilter(s.id)}
                                                            className="flex cursor-pointer items-center gap-2 rounded-lg aria-selected:bg-ant-light"
                                                        >
                                                            <Checkbox
                                                                checked={orderStatusFilterIds.includes(s.id)}
                                                                className="pointer-events-none border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                            />
                                                            <span
                                                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                                style={{ backgroundColor: s.color || '#8B8680' }}
                                                            />
                                                            <span className="font-medium text-ant-ink text-[12px]">{s.label}</span>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            ))}
                                        </CommandList>
                                    </Command>
                                    <div className="flex items-center justify-between gap-2 border-t border-ant-line px-3 py-2.5">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light rounded-full cursor-pointer"
                                            onClick={() => setOrderStatusFilterIds([])}
                                        >
                                            Clear all
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 rounded-full px-4 cursor-pointer"
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
                                            'h-10 rounded-full border-ant-line bg-ant-paper hover:bg-ant-light justify-between gap-2 text-[12px] font-semibold text-ant-ink sm:min-w-[170px]',
                                            packageStatusFilterIds.length > 0 && 'border-ant-orange/40 bg-ant-orange/5'
                                        )}
                                    >
                                        <span className="flex items-center gap-2 truncate">
                                            <Truck className="w-3.5 h-3.5 text-ant-mid" />
                                            <span className="truncate">
                                                {packageStatusFilterIds.length === 0
                                                    ? 'Package status'
                                                    : `${packageStatusFilterIds.length} package status${packageStatusFilterIds.length > 1 ? 'es' : ''}`}
                                            </span>
                                        </span>
                                        <ChevronsUpDown className="w-3 h-3 text-ant-mid" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-[min(100vw-2rem,380px)] p-0 rounded-2xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]"
                                    align="end"
                                    onWheel={(e) => e.stopPropagation()}
                                >
                                    <Command className="rounded-2xl">
                                        <CommandInput placeholder="Search package statuses…" className="h-11" />
                                        <CommandList className="max-h-[min(55vh,300px)]">
                                            <CommandEmpty className="text-[12px] text-ant-mid py-4 font-serif italic">No matching status.</CommandEmpty>
                                            {packageStatusGroups.map((g) => (
                                                <CommandGroup key={g.category} heading={g.heading}>
                                                    {g.items.map((s) => (
                                                        <CommandItem
                                                            key={s.id}
                                                            value={`${s.label} ${g.category}`}
                                                            onSelect={() => togglePackageStatusFilter(s.id)}
                                                            className="flex cursor-pointer items-center gap-2 rounded-lg aria-selected:bg-ant-light"
                                                        >
                                                            <Checkbox
                                                                checked={packageStatusFilterIds.includes(s.id)}
                                                                className="pointer-events-none border-ant-line data-[state=checked]:bg-ant-ink data-[state=checked]:border-ant-ink"
                                                            />
                                                            <span
                                                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                                                style={{ backgroundColor: s.color || '#8B8680' }}
                                                            />
                                                            <span className="font-medium text-ant-ink text-[12px]">{s.label}</span>
                                                        </CommandItem>
                                                    ))}
                                                </CommandGroup>
                                            ))}
                                        </CommandList>
                                    </Command>
                                    <div className="flex items-center justify-between gap-2 border-t border-ant-line px-3 py-2.5">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light rounded-full cursor-pointer"
                                            onClick={() => setPackageStatusFilterIds([])}
                                        >
                                            Clear all
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            className="h-8 text-[11px] font-semibold bg-ant-ink text-white hover:bg-ant-ink/90 rounded-full px-4 cursor-pointer"
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
                                    className="h-10 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink gap-1.5 cursor-pointer"
                                    onClick={() => {
                                        setOrderStatusFilterIds([]);
                                        setPackageStatusFilterIds([]);
                                    }}
                                >
                                    <X className="w-3 h-3" />
                                    Reset
                                </Button>
                            )}

                            <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                                <SelectTrigger className="w-full sm:w-[170px] h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink">
                                    <div className="flex items-center gap-2">
                                        <Filter className="w-3.5 h-3.5 text-ant-mid" />
                                        <SelectValue placeholder="Sort by" />
                                    </div>
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-ant-line">
                                    <SelectItem value="recency" className="text-[12px]">Most recent</SelectItem>
                                    <SelectItem value="value" className="text-[12px]">Highest value</SelectItem>
                                    <SelectItem value="frequency" className="text-[12px]">Most orders</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {customers && filteredData.length !== customers.length && (
                        <p className="font-serif italic text-[11px] text-ant-mid px-1">
                            Showing <span className="not-italic font-semibold text-ant-ink tabular-nums">{filteredData.length}</span> of{' '}
                            <span className="tabular-nums">{customers.length}</span> customers
                        </p>
                    )}
                </div>

                {/* Customer Table */}
                {isLoading ? (
                    <div className="space-y-2">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="h-14 rounded-2xl bg-ant-light animate-pulse" />
                        ))}
                    </div>
                ) : paginatedCustomers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <UsersIcon className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {customers?.length ? 'No customers match these filters' : 'No customer history yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {customers?.length
                                ? 'Relax the filters to bring the ledger back into view.'
                                : 'Each order you record will build a profile here — the ledger grows with every sale.'}
                        </p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Customer</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">City</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Orders</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Spent</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Last order</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Last status</th>
                                        <th className="px-4 py-3" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedCustomers.map((customer) => {
                                        const tier = valueTierPill(customer.status);
                                        return (
                                            <tr
                                                key={customer.id}
                                                className="hover:bg-ant-light/60 transition-colors border-b border-ant-line last:border-0 cursor-pointer"
                                                onClick={() => setSelectedCustomer(customer)}
                                            >
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-9 w-9 rounded-full bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink font-display font-semibold text-[12px] shrink-0">
                                                            {customer.name.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-display text-[13px] font-semibold text-ant-ink leading-tight truncate">
                                                                    {customer.name}
                                                                </p>
                                                                <span className={cn('inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]', tier.bg, tier.border, tier.text)}>
                                                                    <span className={cn('h-1 w-1 rounded-full', tier.dot)} />
                                                                    {customer.status.replace(' Value', '')}
                                                                </span>
                                                            </div>
                                                            <p className="text-[11px] text-ant-mid tabular-nums mt-0.5">{customer.phone}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-[12px] text-ant-ink">{customer.city}</td>
                                                <td className="px-4 py-3 text-right text-[13px] font-semibold text-ant-ink tabular-nums">{customer.totalOrders}</td>
                                                <td className="px-4 py-3 text-right font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                    {customer.totalSpent.toLocaleString()} <span className="text-[11px] text-ant-mid font-normal">DH</span>
                                                </td>
                                                <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums">{format(new Date(customer.lastOrderDate), 'MMM d, yyyy')}</td>
                                                <td className="px-4 py-3">
                                                    {customer.orders[0]?.status?.label && (
                                                        <span
                                                            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                                                            style={{
                                                                backgroundColor: `${customer.orders[0].status.color}12`,
                                                                borderColor: `${customer.orders[0].status.color}40`,
                                                                color: customer.orders[0].status.color,
                                                            }}
                                                        >
                                                            <span
                                                                className="h-1.5 w-1.5 rounded-full"
                                                                style={{ backgroundColor: customer.orders[0].status.color }}
                                                            />
                                                            {customer.orders[0].status.label}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-ant-mid">
                                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
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
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                        </Button>
                        <span className="text-[12px] font-semibold text-ant-ink px-3 tabular-nums">
                            {currentPage} <span className="text-ant-mid">/ {totalPages}</span>
                        </span>
                        <Button
                            variant="outline"
                            size="icon"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                            className="h-9 w-9 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light cursor-pointer"
                        >
                            <ChevronRight className="w-3.5 h-3.5" />
                        </Button>
                    </div>
                )}

                {/* Customer detail dialog */}
                <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
                    <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-ant-line bg-ant-paper shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] p-0 gap-0">
                        {selectedCustomer && (
                            <div className="ant-scroll">
                                {/* Editorial header */}
                                <div className="px-6 pt-6 pb-5 border-b border-ant-line">
                                    <div className="flex items-start gap-4">
                                        <div className="h-14 w-14 rounded-2xl bg-ant-ink/5 border border-ant-line flex items-center justify-center text-ant-ink font-display font-semibold text-[22px] shrink-0">
                                            {selectedCustomer.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0 space-y-1.5">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                                Customer · Profile
                                            </div>
                                            <h2 className="font-display text-[22px] leading-tight tracking-tight text-ant-ink truncate">
                                                {selectedCustomer.name}
                                            </h2>
                                            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ant-mid">
                                                <span className="tabular-nums">{selectedCustomer.phone}</span>
                                                <span>·</span>
                                                <span>{selectedCustomer.city}</span>
                                            </div>
                                        </div>
                                        {(() => {
                                            const tier = valueTierPill(selectedCustomer.status);
                                            return (
                                                <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] shrink-0', tier.bg, tier.border, tier.text)}>
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
                                                    {selectedCustomer.status}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                </div>

                                <div className="p-6 space-y-5">
                                    {/* KPI strip */}
                                    <section className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                                        <CustomerKpi label="Lifetime value" value={selectedCustomer.totalSpent.toLocaleString()} suffix="DH" accent="green" icon={TrendingUp} />
                                        <CustomerKpi label="Total orders" value={String(selectedCustomer.totalOrders)} suffix="orders" accent="ink" icon={ShoppingBag} />
                                        <CustomerKpi label="Avg. order" value={Math.round(selectedCustomer.avgOrderValue).toLocaleString()} suffix="DH" accent="orange" icon={Coins} />
                                        <CustomerKpi label="Loyalty score" value={String(selectedCustomer.interactionScore)} suffix="pts" accent="rose" icon={Activity} />
                                    </section>

                                    {/* Chart */}
                                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="h-[3px] w-full bg-ant-orange" />
                                        <div className="p-5">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-3">
                                                <TrendingUp className="w-3 h-3" />
                                                Order history
                                            </div>
                                            <div className="h-[200px]">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                                                        <defs>
                                                            <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                                                                <stop offset="5%" stopColor="#D97706" stopOpacity={0.3} />
                                                                <stop offset="95%" stopColor="#D97706" stopOpacity={0} />
                                                            </linearGradient>
                                                        </defs>
                                                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#8B8680', fontSize: 10 }} dy={6} />
                                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#8B8680', fontSize: 10 }} tickFormatter={(v) => `${v}`} />
                                                        <CartesianGrid vertical={false} stroke="#E6E1D6" strokeDasharray="3 3" />
                                                        <Tooltip
                                                            contentStyle={{
                                                                borderRadius: '12px',
                                                                border: '1px solid #E6E1D6',
                                                                background: '#FAF9F4',
                                                                fontSize: '12px',
                                                                padding: '8px 12px',
                                                                boxShadow: '0 16px 48px -20px rgba(20,20,19,0.2)',
                                                            }}
                                                            cursor={{ stroke: '#D97706', strokeWidth: 1 }}
                                                            formatter={(v: any) => [`${v} DH`, 'Amount']}
                                                        />
                                                        <Area type="monotone" dataKey="amount" stroke="#D97706" strokeWidth={1.75} fillOpacity={1} fill="url(#colorAmount)" activeDot={{ r: 4, strokeWidth: 0, fill: '#D97706' }} />
                                                    </AreaChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Orders table */}
                                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="px-5 py-3.5 border-b border-ant-line flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <ShoppingBag className="w-3 h-3" />
                                                Order history
                                            </div>
                                            <span className="text-[11px] font-semibold text-ant-mid tabular-nums">
                                                {selectedCustomer.orders.length} {selectedCustomer.orders.length === 1 ? 'order' : 'orders'}
                                            </span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full">
                                                <thead>
                                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Date</th>
                                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Status</th>
                                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">City</th>
                                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Amount</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedCustomer.orders.map((order) => (
                                                        <tr key={order.id} className="hover:bg-ant-light/60 transition-colors border-b border-ant-line last:border-0">
                                                            <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums">{format(new Date(order.date), 'MMM d, yyyy')}</td>
                                                            <td className="px-4 py-3">
                                                                <span
                                                                    className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                                                                    style={{
                                                                        backgroundColor: `${order.status.color}12`,
                                                                        borderColor: `${order.status.color}40`,
                                                                        color: order.status.color,
                                                                    }}
                                                                >
                                                                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: order.status.color }} />
                                                                    {order.status.label}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-[12px] text-ant-ink">{order.city_name}</td>
                                                            <td className="px-4 py-3 text-right font-display text-[13px] font-semibold text-ant-ink tabular-nums">
                                                                {order.price.toLocaleString()} <span className="text-[10px] text-ant-mid font-normal">DH</span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default Customers;
