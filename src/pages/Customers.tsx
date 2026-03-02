import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
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
    X,
    ChevronLeft,
    ChevronRight,
    Loader2,
    Users as UsersIcon,
    DollarSign,
    Activity
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
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

// --- Types ---

interface Order {
    id: string;
    date: string;
    price: number;
    shipping_cost: number;
    order_status_id: string;
    package_status_id: string | null;
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
    const activeBusinessId = localStorage.getItem('activeBusinessId');

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
                    city:master_cities(name),
                    status:order_statuses(label, color)
                `)
                .eq('DigiCom Business', activeBusinessId)
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
                    o.package_status_id != null &&
                    statusCats.deliveredPkgIds.has(o.package_status_id)
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
        let res = customers.filter(c =>
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
    }, [customers, searchQuery, sortBy]);

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


    if (isLoading) {
        return (
            <div className="flex h-[80vh] items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 animate-spin text-brand-navy" />
                    <p className="text-muted-foreground animate-pulse font-medium">Loading customers...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-20">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Customers</h1>
                            <p className="text-gray-500 font-light">Manage your customer base and view insights.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button variant="outline" className="h-12 px-6 rounded-2xl border-gray-200 hover:bg-gray-50 text-gray-700 font-medium gap-2">
                                <Download className="w-5 h-5" />
                                Export List
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="rounded-[32px] border-none shadow-lg bg-gradient-to-br from-brand-navy to-brand-navy/90 text-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-medium opacity-80">Total Customers</CardTitle>
                        <UsersIcon className="w-6 h-6 opacity-60" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black">{stats.total.toLocaleString()}</div>
                        <p className="text-sm opacity-60 mt-1">Active database entries</p>
                    </CardContent>
                </Card>
                <Card className="rounded-[32px] border-none shadow-lg bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-medium text-brand-navy/60">Total Lifetime Value</CardTitle>
                        <DollarSign className="w-6 h-6 text-brand-navy/40" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-brand-navy">{stats.revenue.toLocaleString()} MAD</div>
                        <p className="text-sm text-brand-navy/40 mt-1">Across all orders</p>
                    </CardContent>
                </Card>
                <Card className="rounded-[32px] border-none shadow-lg bg-white">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-lg font-medium text-brand-navy/60">Avg. Customer Value</CardTitle>
                        <Activity className="w-6 h-6 text-brand-navy/40" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black text-brand-navy">{stats.avgValue.toFixed(0)} MAD</div>
                        <p className="text-sm text-brand-navy/40 mt-1">Per customer average</p>
                    </CardContent>
                </Card>
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-[24px] shadow-sm border border-brand-navy/5">
                <div className="relative w-full md:w-96">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                        placeholder="Search by name, phone, city..."
                        className="pl-11 h-12 rounded-xl border-brand-navy/10 focus:border-brand-navy focus:ring-brand-navy bg-brand-navy/[0.02]"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-3 w-full md:w-auto">
                    <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                        <SelectTrigger className="w-full md:w-[180px] h-12 rounded-xl border-brand-navy/10">
                            <div className="flex items-center gap-2">
                                <Filter className="w-4 h-4 opacity-50" />
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

            {/* Customer Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {paginatedCustomers.map((customer) => (
                    <Card
                        key={customer.id}
                        onClick={() => setSelectedCustomer(customer)}
                        className="group relative cursor-pointer border-none shadow-md hover:shadow-xl transition-all duration-300 hover:-translate-y-1 rounded-[32px] overflow-hidden bg-white"
                    >
                        <div className={cn(
                            "absolute top-0 left-0 w-full h-2",
                            customer.status === 'High Value' ? "bg-gradient-to-r from-yellow-400 to-orange-500" :
                                customer.status === 'Mid Value' ? "bg-gradient-to-r from-blue-400 to-indigo-500" :
                                    "bg-gradient-to-r from-gray-200 to-gray-300"
                        )} />

                        <CardContent className="p-6 pt-8 space-y-4">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-2xl bg-brand-navy/5 flex items-center justify-center text-brand-navy font-bold text-xl group-hover:scale-110 transition-transform">
                                        {customer.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-lg text-brand-navy leading-tight line-clamp-1">{customer.name}</h3>
                                        <div className="flex items-center gap-1.5 text-muted-foreground text-sm mt-0.5">
                                            <Phone className="w-3 h-3" />
                                            <span className="font-mono tracking-tight">{customer.phone}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 py-3 border-y border-dashed border-brand-navy/10">
                                <div>
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Spent</div>
                                    <div className="font-black text-brand-navy text-lg">{customer.totalSpent.toLocaleString()} <span className="text-xs font-medium text-muted-foreground">dh</span></div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Orders</div>
                                    <div className="font-black text-brand-navy text-lg">{customer.totalOrders}</div>
                                </div>
                            </div>

                            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                                <div className="flex items-center gap-1.5">
                                    <MapPin className="w-3.5 h-3.5" />
                                    {customer.city}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Calendar className="w-3.5 h-3.5" />
                                    {format(new Date(customer.lastOrderDate), 'MMM d, yyyy')}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="rounded-xl"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span className="text-sm font-bold text-brand-navy px-4">
                        Page {currentPage} of {totalPages}
                    </span>
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="rounded-xl"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            )}

            {/* Detailed Customer Modal */}
            <Dialog open={!!selectedCustomer} onOpenChange={(open) => !open && setSelectedCustomer(null)}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-[40px] border-none shadow-2xl p-0 gap-0">
                    {selectedCustomer && (
                        <div>
                            {/* Modal Header */}
                            <div className="bg-brand-navy p-8 text-brand-white relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32 blur-3xl pointer-events-none" />
                                <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
                                    <div className="flex items-center gap-6">
                                        <div className="w-20 h-20 rounded-[24px] bg-white/10 backdrop-blur-md flex items-center justify-center text-3xl font-bold shadow-inner border border-white/20">
                                            {selectedCustomer.name.charAt(0)}
                                        </div>
                                        <div>
                                            <h2 className="text-3xl font-bold">{selectedCustomer.name}</h2>
                                            <div className="flex flex-wrap gap-4 mt-2 text-brand-white/70">
                                                <div className="flex items-center gap-2 text-sm bg-white/10 px-3 py-1 rounded-full">
                                                    <Phone className="w-3.5 h-3.5" /> {selectedCustomer.phone}
                                                </div>
                                                <div className="flex items-center gap-2 text-sm bg-white/10 px-3 py-1 rounded-full">
                                                    <MapPin className="w-3.5 h-3.5" /> {selectedCustomer.city}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-2">
                                        <Badge className={`
                                            px-4 py-1.5 rounded-full text-sm font-bold border-none
                                            ${selectedCustomer.status === 'High Value' ? 'bg-amber-400 text-amber-950' :
                                                selectedCustomer.status === 'Mid Value' ? 'bg-blue-400 text-blue-950' :
                                                    'bg-slate-200 text-slate-800'}
                                        `}>
                                            {selectedCustomer.status}
                                        </Badge>
                                        <span className="text-xs font-medium text-brand-white/50 uppercase tracking-widest">
                                            Member since {format(new Date(selectedCustomer.firstOrderDate), 'MMM yyyy')}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="p-8 space-y-8 bg-slate-50/50">
                                {/* Stats Grid */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <Card className="rounded-2xl border-none shadow-sm bg-white p-4 text-center">
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Lifetime Value</div>
                                        <div className="text-2xl font-black text-brand-navy">{selectedCustomer.totalSpent.toLocaleString()} dh</div>
                                    </Card>
                                    <Card className="rounded-2xl border-none shadow-sm bg-white p-4 text-center">
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Total Orders</div>
                                        <div className="text-2xl font-black text-brand-navy">{selectedCustomer.totalOrders}</div>
                                    </Card>
                                    <Card className="rounded-2xl border-none shadow-sm bg-white p-4 text-center">
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Avg. Order</div>
                                        <div className="text-2xl font-black text-brand-navy">{selectedCustomer.avgOrderValue.toFixed(0)} dh</div>
                                    </Card>
                                    <Card className="rounded-2xl border-none shadow-sm bg-white p-4 text-center">
                                        <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">Score</div>
                                        <div className="text-2xl font-black text-brand-navy">{selectedCustomer.interactionScore}</div>
                                    </Card>
                                </div>

                                {/* Interaction Chart */}
                                <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
                                    <CardHeader>
                                        <CardTitle className="text-lg font-bold text-brand-navy">Order Amount History</CardTitle>
                                    </CardHeader>
                                    <CardContent className="h-[300px] w-full mt-4">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                                <defs>
                                                    <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="5%" stopColor="#1e293b" stopOpacity={0.1} />
                                                        <stop offset="95%" stopColor="#1e293b" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <XAxis
                                                    dataKey="date"
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                                    dy={10}
                                                />
                                                <YAxis
                                                    axisLine={false}
                                                    tickLine={false}
                                                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                                                    tickFormatter={(value) => `${value}dh`}
                                                />
                                                <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
                                                <Tooltip
                                                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                                                    cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                                                />
                                                <Area
                                                    type="monotone"
                                                    dataKey="amount"
                                                    stroke="#1e293b"
                                                    strokeWidth={3}
                                                    fillOpacity={1}
                                                    fill="url(#colorAmount)"
                                                    activeDot={{ r: 6, strokeWidth: 0, fill: '#1e293b' }}
                                                />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </CardContent>
                                </Card>

                                {/* Transaction History */}
                                <Card className="border-none shadow-sm rounded-3xl bg-white overflow-hidden">
                                    <CardHeader>
                                        <CardTitle className="text-lg font-bold text-brand-navy">Transaction History</CardTitle>
                                    </CardHeader>
                                    <div className="p-0">
                                        <Table>
                                            <TableHeader className="bg-slate-50">
                                                <TableRow className="border-none">
                                                    <TableHead className="font-bold pl-8">Date</TableHead>
                                                    <TableHead className="font-bold">Status</TableHead>
                                                    <TableHead className="font-bold">City</TableHead>
                                                    <TableHead className="font-bold text-right pr-8">Amount</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {selectedCustomer.orders.map((order) => (
                                                    <TableRow key={order.id} className="hover:bg-slate-50 border-slate-100">
                                                        <TableCell className="pl-8 font-medium">
                                                            {format(new Date(order.date), 'MMM d, yyyy')}
                                                            <div className="text-xs text-muted-foreground">{format(new Date(order.date), 'h:mm a')}</div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <Badge
                                                                style={{ backgroundColor: `${order.status.color}20`, color: order.status.color }}
                                                                className="border-none font-bold"
                                                            >
                                                                {order.status.label}
                                                            </Badge>
                                                        </TableCell>
                                                        <TableCell className="text-muted-foreground">{order.city_name}</TableCell>
                                                        <TableCell className="text-right pr-8 font-bold text-brand-navy">
                                                            {order.price.toLocaleString()} dh
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </Card>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Customers;
