import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    History,
    Wallet,
    Trash2,
    Loader2,
    User,
    Phone,
    MapPin,
    Calendar,
    Receipt,
    CheckCircle2,
    Clock,
    DollarSign,
    Package,
    PlusCircle,
    X,
    Eye,
    Puzzle,
    LayoutGrid,
    LayoutList,
    Pencil,
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
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
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

// --- Schemas ---
const transactionSchema = z.object({
    name: z.string().min(2, "Supplier name is required"),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal('')),
    address: z.string().optional(),
    note: z.string().optional(),
    date: z.string().default(new Date().toISOString().split('T')[0]),
    items: z.array(z.object({
        type: z.enum(['product', 'accessory']).default('product'),
        product_id: z.string().optional().default(''),
        accessory_id: z.string().optional().default(''),
        quantity: z.coerce.number().min(1, "Quantity must be at least 1"),
        unit_price: z.coerce.number().min(0, "Price must be positive"),
    })).min(1, "At least one item is required"),
});

const paymentSchema = z.object({
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    method: z.string().min(1, "Payment method is required"),
    date: z.string().default(new Date().toISOString().split('T')[0]),
    note: z.string().optional(),
});

type TransactionFormValues = z.infer<typeof transactionSchema>;
type PaymentFormValues = z.infer<typeof paymentSchema>;

function getPaymentStatus(tx: any): 'paid' | 'partial' | 'unpaid' {
    const total = Number(tx.total_price || 0);
    const paid = Number(tx.paid_price || 0);
    const balance = total - paid;
    if (total > 0 && balance <= 0) return 'paid';
    if (paid > 0 && balance > 0) return 'partial';
    return 'unpaid';
}

const defaultTransactionFormValues: TransactionFormValues = {
    name: '',
    phone: '',
    email: '',
    address: '',
    note: '',
    date: new Date().toISOString().split('T')[0],
    items: [{ type: 'product' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 }],
};

function mapPurchaseRowToFormItem(row: any): TransactionFormValues['items'][number] | null {
    if (row.product_id) {
        const qty = Math.max(1, Number(row.quantity || 1));
        const sub = Number(row.sub_total || 0);
        const unit = qty > 0 ? sub / qty : 0;
        return {
            type: 'product',
            product_id: row.product_id,
            accessory_id: '',
            quantity: qty,
            unit_price: unit,
        };
    }
    if (row.accessory_id) {
        const qty = Math.max(1, Number(row.accessory_quantity || 1));
        const sub = Number(row.accessory_sub_total || 0);
        const unit = qty > 0 ? sub / qty : 0;
        return {
            type: 'accessory',
            product_id: '',
            accessory_id: row.accessory_id,
            quantity: qty,
            unit_price: unit,
        };
    }
    return null;
}

function mapTransactionToFormValues(tx: any): TransactionFormValues {
    const raw = (tx.items || [])
        .map(mapPurchaseRowToFormItem)
        .filter(Boolean) as TransactionFormValues['items'];
    const items =
        raw.length > 0
            ? raw
            : [{ type: 'product' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 }];
    const d = tx.date ? new Date(tx.date) : new Date(tx.created_at || Date.now());
    const dateStr = Number.isNaN(d.getTime()) ? new Date().toISOString().split('T')[0] : format(d, 'yyyy-MM-dd');
    return {
        name: tx.name || '',
        phone: tx.phone || '',
        email: tx.email || '',
        address: tx.address || '',
        note: tx.note || '',
        date: dateStr,
        items,
    };
}

const Transactions = () => {
    const [transactionModalOpen, setTransactionModalOpen] = useState(false);
    const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
    const [statusFilter, setStatusFilter] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
    const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: transactions, isLoading } = useQuery({
        queryKey: ['transactions', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('transactions')
                .select(`
                    *,
                    items:trns_purchase(*, product:products(name, code), accessory:accessories(name, code)),
                    payments:trns_payment(*)
                `)
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const { data: products } = useQuery({
        queryKey: ['products-minimal', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('products')
                .select('id, name, code, cost_price')
                .eq('DigiCom Business', activeBusinessId)
                .eq('active', true);
            if (error) throw error;
            return data;
        },
    });

    const { data: accessories } = useQuery({
        queryKey: ['accessories-minimal', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('accessories')
                .select('id, name, code, cost_price')
                .eq('DigiCom Business', activeBusinessId)
                .eq('active', true);
            if (error) throw error;
            return data;
        },
    });

    // --- Forms ---
    const transactionForm = useForm<TransactionFormValues>({
        resolver: zodResolver(transactionSchema),
        defaultValues: defaultTransactionFormValues,
    });

    const { fields, append, remove } = useFieldArray({
        control: transactionForm.control,
        name: "items"
    });

    const paymentForm = useForm<PaymentFormValues>({
        resolver: zodResolver(paymentSchema),
        defaultValues: {
            amount: 0,
            method: 'Cash',
            date: new Date().toISOString().split('T')[0],
        }
    });

    // --- Mutations ---
    const createTransactionMutation = useMutation({
        mutationFn: async (values: TransactionFormValues) => {
            // 1. Create transaction header
            const { data: tx, error: txError } = await supabase
                .from('transactions')
                .insert({
                    name: values.name,
                    phone: values.phone,
                    email: values.email || null,
                    address: values.address,
                    note: values.note,
                    date: values.date,
                    'DigiCom Business': activeBusinessId
                })
                .select()
                .single();

            if (txError) throw txError;

            // 2. Create purchase items
            const items = values.items.map(item => ({
                transaction_id: tx.id,
                product_id: (item.type === 'product' && item.product_id && item.product_id !== 'none') ? item.product_id : null,
                accessory_id: (item.type === 'accessory' && item.accessory_id && item.accessory_id !== 'none') ? item.accessory_id : null,
                quantity: item.type === 'product' ? item.quantity : 0,
                sub_total: item.type === 'product' ? item.quantity * item.unit_price : 0,
                accessory_quantity: item.type === 'accessory' ? item.quantity : 0,
                accessory_sub_total: item.type === 'accessory' ? item.quantity * item.unit_price : 0,
                'DigiCom Business': activeBusinessId
            }));

            const { error: itemsError } = await supabase
                .from('trns_purchase')
                .insert(items);

            if (itemsError) throw itemsError;

            return tx;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products', activeBusinessId] }); // Stock changed
            queryClient.invalidateQueries({ queryKey: ['accessories', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories-minimal', activeBusinessId] });
            setTransactionModalOpen(false);
            setEditingTransactionId(null);
            transactionForm.reset(defaultTransactionFormValues);
            toast({ title: "Transaction Created", description: "Purchases and stock updated successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const updateTransactionMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string; values: TransactionFormValues }) => {
            const { error: txError } = await supabase
                .from('transactions')
                .update({
                    name: values.name,
                    phone: values.phone || null,
                    email: values.email || null,
                    address: values.address || null,
                    note: values.note || null,
                    date: values.date,
                })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);

            if (txError) throw txError;

            const { error: delError } = await supabase.from('trns_purchase').delete().eq('transaction_id', id);
            if (delError) throw delError;

            const rows = values.items.map((item) => ({
                transaction_id: id,
                product_id:
                    item.type === 'product' && item.product_id && item.product_id !== 'none' ? item.product_id : null,
                accessory_id:
                    item.type === 'accessory' && item.accessory_id && item.accessory_id !== 'none'
                        ? item.accessory_id
                        : null,
                quantity: item.type === 'product' ? item.quantity : 0,
                sub_total: item.type === 'product' ? item.quantity * item.unit_price : 0,
                accessory_quantity: item.type === 'accessory' ? item.quantity : 0,
                accessory_sub_total: item.type === 'accessory' ? item.quantity * item.unit_price : 0,
                'DigiCom Business': activeBusinessId,
            }));

            const { error: itemsError } = await supabase.from('trns_purchase').insert(rows);
            if (itemsError) throw itemsError;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['products', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories', activeBusinessId] });
            queryClient.invalidateQueries({ queryKey: ['accessories-minimal', activeBusinessId] });
            setTransactionModalOpen(false);
            setEditingTransactionId(null);
            transactionForm.reset(defaultTransactionFormValues);
            toast({ title: 'Transaction updated', description: 'Supplier details and line items saved.' });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const addPaymentMutation = useMutation({
        mutationFn: async (values: PaymentFormValues) => {
            const { data, error } = await supabase
                .from('trns_payment')
                .insert({
                    transaction_id: selectedTransaction.id,
                    amount: values.amount,
                    method: values.method,
                    date: values.date,
                    'DigiCom Business': activeBusinessId
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions', activeBusinessId] });
            setIsPaymentModalOpen(false);
            paymentForm.reset();
            toast({ title: "Payment Added", description: "Ledger updated successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteTransactionMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('transactions')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions', activeBusinessId] });
            setIsDeleteDialogOpen(false);
            setSelectedTransaction(null);
            toast({ title: "Transaction Deleted", description: "Record removed successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // --- Helpers ---
    const displayTransactions = useMemo(() => {
        if (!transactions?.length) return [];
        const q = searchQuery.trim().toLowerCase();
        let list = transactions.filter((tx) => {
            const matchSearch =
                !q ||
                (tx.name || '').toLowerCase().includes(q) ||
                (tx.phone || '').includes(searchQuery.trim());
            if (!matchSearch) return false;
            if (statusFilter === 'all') return true;
            return getPaymentStatus(tx) === statusFilter;
        });
        list = [...list].sort((a, b) => {
            const da = new Date(a.created_at || a.date || 0).getTime();
            const db = new Date(b.created_at || b.date || 0).getTime();
            return sortOrder === 'newest' ? db - da : da - db;
        });
        return list;
    }, [transactions, searchQuery, statusFilter, sortOrder]);

    const getStatusBadge = (tx: any) => {
        const balance = (tx.total_price || 0) - (tx.paid_price || 0);
        if (balance <= 0 && tx.total_price > 0) return <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold">PAID</Badge>;
        if (tx.paid_price > 0) return <Badge className="bg-amber-50 text-amber-600 border-none font-bold">PARTIAL</Badge>;
        return <Badge className="bg-red-50 text-red-600 border-none font-bold">UNPAID</Badge>;
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Supplier Transactions</h1>
                            <p className="text-gray-500 font-light">Manage your inventory purchases and payments ledger.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                            <Button
                                onClick={() => {
                                    setEditingTransactionId(null);
                                    transactionForm.reset(defaultTransactionFormValues);
                                    setTransactionModalOpen(true);
                                }}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                            >
                                <PlusCircle className="w-5 h-5" />
                                New Purchase
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters bar */}
            <Card className="border border-brand-navy/[0.06] shadow-sm rounded-[28px] bg-white/80 backdrop-blur-sm">
                <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="relative group flex-1 min-w-0 max-w-xl">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors pointer-events-none" />
                            <Input
                                placeholder="Search supplier or phone..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-11 h-11 rounded-2xl border-gray-100 bg-white"
                            />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
                                <SelectTrigger className="h-11 w-[140px] rounded-2xl border-gray-100 bg-white text-xs font-bold">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="all" className="rounded-xl">All statuses</SelectItem>
                                    <SelectItem value="paid" className="rounded-xl">Paid</SelectItem>
                                    <SelectItem value="partial" className="rounded-xl">Partial</SelectItem>
                                    <SelectItem value="unpaid" className="rounded-xl">Unpaid</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
                                <SelectTrigger className="h-11 w-[150px] rounded-2xl border-gray-100 bg-white text-xs font-bold">
                                    <SelectValue placeholder="Sort" />
                                </SelectTrigger>
                                <SelectContent className="rounded-2xl">
                                    <SelectItem value="newest" className="rounded-xl">Newest first</SelectItem>
                                    <SelectItem value="oldest" className="rounded-xl">Oldest first</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="flex rounded-2xl border border-gray-100 bg-brand-navy/[0.03] p-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setViewMode('list')}
                                    className={cn(
                                        'h-9 px-3 rounded-xl gap-2 font-bold text-xs',
                                        viewMode === 'list'
                                            ? 'bg-brand-navy text-white hover:bg-brand-navy hover:text-white shadow-sm'
                                            : 'text-brand-navy/70 hover:bg-white/80'
                                    )}
                                >
                                    <LayoutList className="w-4 h-4" />
                                    List
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setViewMode('grid')}
                                    className={cn(
                                        'h-9 px-3 rounded-xl gap-2 font-bold text-xs',
                                        viewMode === 'grid'
                                            ? 'bg-brand-navy text-white hover:bg-brand-navy hover:text-white shadow-sm'
                                            : 'text-brand-navy/70 hover:bg-white/80'
                                    )}
                                >
                                    <LayoutGrid className="w-4 h-4" />
                                    Grid
                                </Button>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Content Section */}
            {isLoading ? (
                viewMode === 'list' ? (
                    <div className="rounded-[28px] border border-brand-navy/[0.06] bg-white overflow-hidden divide-y divide-brand-navy/[0.06]">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="p-4 sm:p-5">
                                <Skeleton className="h-14 w-full rounded-2xl" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <Skeleton key={i} className="h-64 w-full rounded-[32px]" />
                        ))}
                    </div>
                )
            ) : displayTransactions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-brand-white rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <History className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">No transactions found</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">
                            {transactions?.length
                                ? 'Try adjusting search or filters.'
                                : 'Start logging your supplier purchases to track stock and payments.'}
                        </p>
                    </div>
                </div>
            ) : viewMode === 'list' ? (
                <div className="rounded-[32px] border border-brand-navy/[0.06] bg-white shadow-sm overflow-hidden divide-y divide-brand-navy/[0.06]">
                    {displayTransactions.map((tx) => (
                        <div
                            key={tx.id}
                            className="group grid grid-cols-1 items-center gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,auto)_auto] lg:gap-6 hover:bg-brand-navy/[0.02] transition-colors"
                        >
                            <div className="flex min-w-0 items-start gap-3">
                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-navy/[0.06] text-brand-navy">
                                    <User className="h-5 w-5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="truncate text-base font-bold text-brand-navy">{tx.name}</h3>
                                        {getStatusBadge(tx)}
                                    </div>
                                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
                                            <Calendar className="h-3 w-3 shrink-0" />
                                            {format(new Date(tx.date || tx.created_at), 'MMM dd, yyyy')}
                                        </span>
                                        {tx.phone ? (
                                            <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
                                                <Phone className="h-3 w-3 shrink-0" />
                                                {tx.phone}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            <div className="flex w-full min-w-0 justify-center">
                                <div className="grid w-full max-w-[20rem] grid-cols-2 gap-x-6 gap-y-3 xs:max-w-[22rem] sm:max-w-[26rem] sm:grid-cols-4 sm:gap-x-8 sm:gap-y-0">
                                    <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center">
                                        <p className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">
                                            Total
                                        </p>
                                        <p className="w-full text-base font-bold tabular-nums tracking-tight text-brand-navy sm:text-lg">
                                            {tx.total_price || 0}{' '}
                                            <span className="text-[10px] font-bold text-muted-foreground/80">DH</span>
                                        </p>
                                    </div>
                                    <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center">
                                        <p className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">
                                            Balance
                                        </p>
                                        <p
                                            className={cn(
                                                'w-full text-base font-bold tabular-nums tracking-tight sm:text-lg',
                                                (tx.total_price || 0) - (tx.paid_price || 0) > 0 ? 'text-red-500' : 'text-emerald-600'
                                            )}
                                        >
                                            {(tx.total_price || 0) - (tx.paid_price || 0)}{' '}
                                            <span className="text-[10px] font-bold text-muted-foreground/80">DH</span>
                                        </p>
                                    </div>
                                    <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center">
                                        <p className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">
                                            Items
                                        </p>
                                        <p className="w-full text-base font-bold tabular-nums text-brand-navy sm:text-lg">
                                            {tx.items?.length || 0}
                                        </p>
                                    </div>
                                    <div className="flex min-w-0 flex-col items-center justify-center gap-1 text-center">
                                        <p className="whitespace-nowrap text-[9px] font-black uppercase tracking-widest text-muted-foreground/70">
                                            Payments
                                        </p>
                                        <p className="w-full text-base font-bold tabular-nums text-brand-navy sm:text-lg">
                                            {tx.payments?.length || 0}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2 lg:justify-end">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="View details"
                                    onClick={() => {
                                        setSelectedTransaction(tx);
                                        setIsViewModalOpen(true);
                                    }}
                                    className="h-10 w-10 shrink-0 rounded-xl bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy hover:text-white"
                                >
                                    <Eye className="h-5 w-5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Edit transaction"
                                    onClick={() => {
                                        setEditingTransactionId(tx.id);
                                        transactionForm.reset(mapTransactionToFormValues(tx));
                                        setTransactionModalOpen(true);
                                    }}
                                    className="h-10 w-10 shrink-0 rounded-xl bg-brand-navy/[0.04] text-brand-navy hover:bg-amber-500 hover:text-white"
                                >
                                    <Pencil className="h-5 w-5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Record payment"
                                    onClick={() => {
                                        setSelectedTransaction(tx);
                                        paymentForm.setValue('amount', (tx.total_price || 0) - (tx.paid_price || 0));
                                        setIsPaymentModalOpen(true);
                                    }}
                                    className="h-10 w-10 shrink-0 rounded-xl bg-brand-navy/[0.04] text-brand-navy hover:bg-emerald-600 hover:text-white"
                                >
                                    <Wallet className="h-5 w-5" />
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title="Delete"
                                    onClick={() => {
                                        setSelectedTransaction(tx);
                                        setIsDeleteDialogOpen(true);
                                    }}
                                    className="h-10 w-10 shrink-0 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white"
                                >
                                    <Trash2 className="h-5 w-5" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {displayTransactions.map((tx) => (
                        <Card
                            key={tx.id}
                            className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm transition-all duration-500 hover:shadow-2xl rounded-[32px]"
                        >
                            <CardContent className="space-y-6 p-8">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-navy/[0.04] text-brand-navy">
                                                <User className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="truncate text-xl font-bold text-brand-navy">{tx.name}</h3>
                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                    <Calendar className="h-3 w-3" />
                                                    <span className="text-[10px] font-bold uppercase tracking-wider">
                                                        {format(new Date(tx.date || tx.created_at), 'MMM dd, yyyy')}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {getStatusBadge(tx)}
                                </div>

                                <div className="grid grid-cols-2 gap-6 py-2">
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Total Bill</p>
                                        <p className="text-2xl font-bold text-brand-navy">{tx.total_price || 0} DH</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Debt Balance</p>
                                        <p
                                            className={cn(
                                                'text-2xl font-bold',
                                                (tx.total_price || 0) - (tx.paid_price || 0) > 0 ? 'text-red-500' : 'text-emerald-500'
                                            )}
                                        >
                                            {(tx.total_price || 0) - (tx.paid_price || 0)} DH
                                        </p>
                                    </div>
                                </div>

                                <Separator className="bg-brand-navy/[0.05]" />

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Items</span>
                                            <span className="text-sm font-bold text-brand-navy">{tx.items?.length || 0} kinds</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Payments</span>
                                            <span className="text-sm font-bold text-brand-navy">{tx.payments?.length || 0} tranches</span>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            title="View details"
                                            onClick={() => {
                                                setSelectedTransaction(tx);
                                                setIsViewModalOpen(true);
                                            }}
                                            className="h-10 w-10 rounded-xl bg-brand-navy/[0.04] text-brand-navy transition-all hover:bg-brand-navy hover:text-white"
                                        >
                                            <Eye className="h-5 w-5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            title="Edit transaction"
                                            onClick={() => {
                                                setEditingTransactionId(tx.id);
                                                transactionForm.reset(mapTransactionToFormValues(tx));
                                                setTransactionModalOpen(true);
                                            }}
                                            className="h-10 w-10 rounded-xl bg-brand-navy/[0.04] text-brand-navy hover:bg-amber-500 hover:text-white"
                                        >
                                            <Pencil className="h-5 w-5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            title="Record payment"
                                            onClick={() => {
                                                setSelectedTransaction(tx);
                                                paymentForm.setValue('amount', (tx.total_price || 0) - (tx.paid_price || 0));
                                                setIsPaymentModalOpen(true);
                                            }}
                                            className="h-10 w-10 rounded-xl bg-brand-navy/[0.04] text-brand-navy hover:bg-emerald-600 hover:text-white"
                                        >
                                            <Wallet className="h-5 w-5" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            title="Delete"
                                            onClick={() => {
                                                setSelectedTransaction(tx);
                                                setIsDeleteDialogOpen(true);
                                            }}
                                            className="h-10 w-10 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white"
                                        >
                                            <Trash2 className="h-5 w-5" />
                                        </Button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Create / Edit Transaction Modal */}
            <Dialog
                open={transactionModalOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setTransactionModalOpen(false);
                        setEditingTransactionId(null);
                        transactionForm.reset(defaultTransactionFormValues);
                    }
                }}
            >
                <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    <Form {...transactionForm}>
                        <form
                            onSubmit={transactionForm.handleSubmit((v) => {
                                if (editingTransactionId) {
                                    updateTransactionMutation.mutate({ id: editingTransactionId, values: v });
                                } else {
                                    createTransactionMutation.mutate(v);
                                }
                            })}
                            className="flex flex-col flex-1 min-h-0"
                        >
                            <DialogHeader className="p-8 pb-4 shrink-0">
                                <DialogTitle className="text-3xl font-bold text-brand-navy">
                                    {editingTransactionId ? 'Edit purchase transaction' : 'New Purchase Transaction'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground text-lg">
                                    {editingTransactionId
                                        ? 'Update supplier details, dates, and line items. Payments on this transaction are unchanged.'
                                        : 'Log supplier invoices and update inventory stock instantly.'}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-8 pt-4 space-y-8 flex-1 min-h-0 custom-scrollbar">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-6">
                                        <h4 className="text-xs font-black uppercase tracking-widest text-brand-navy/40 border-b border-brand-navy/[0.05] pb-2">Supplier Profile</h4>
                                        <div className="grid grid-cols-1 gap-4">
                                            <FormField
                                                control={transactionForm.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Supplier Name</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/30" />
                                                                <Input placeholder="E.g. Global Supplies Ltd" {...field} className="pl-11 h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                            </div>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <div className="grid grid-cols-2 gap-4">
                                                <FormField
                                                    control={transactionForm.control}
                                                    name="phone"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2">
                                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Phone</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="+212..." {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={transactionForm.control}
                                                    name="date"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-2">
                                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Transaction Date</FormLabel>
                                                            <FormControl>
                                                                <Input type="date" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-6">
                                        <h4 className="text-xs font-black uppercase tracking-widest text-brand-navy/40 border-b border-brand-navy/[0.05] pb-2">Logistics & Notes</h4>
                                        <div className="grid grid-cols-1 gap-4">
                                            <FormField
                                                control={transactionForm.control}
                                                name="address"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Supplier Address</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Warehouse location..." {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={transactionForm.control}
                                                name="note"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-2">
                                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Internal Notes</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Extra details about this order..." {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-inner" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-6">
                                    <div className="flex items-center justify-between border-b border-brand-navy/[0.05] pb-2">
                                        <h4 className="text-xs font-black uppercase tracking-widest text-brand-navy/40">Invoice Items</h4>
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => append({ type: 'product' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 })}
                                                className="text-xs font-bold text-brand-navy hover:bg-brand-navy/[0.05] gap-1.5 rounded-xl"
                                            >
                                                <Package className="w-3.5 h-3.5" /> Add Product
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => append({ type: 'accessory' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 })}
                                                className="text-xs font-bold text-amber-700 hover:bg-amber-50 gap-1.5 rounded-xl"
                                            >
                                                <Puzzle className="w-3.5 h-3.5" /> Add Accessory
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        {fields.map((field, index) => {
                                            const itemType = transactionForm.watch(`items.${index}.type`);
                                            const lineSubtotal = (transactionForm.watch(`items.${index}.quantity`) || 0) * (transactionForm.watch(`items.${index}.unit_price`) || 0);
                                            const isProduct = itemType === 'product';
                                            return (
                                                <div key={field.id} className={cn(
                                                    "p-5 rounded-[24px] border space-y-1 animate-in slide-in-from-left-2 duration-300",
                                                    isProduct
                                                        ? "bg-brand-navy/[0.015] border-brand-navy/[0.04]"
                                                        : "bg-amber-50/50 border-amber-200/40"
                                                )}>
                                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
                                                        <div className="md:col-span-5">
                                                            {isProduct ? (
                                                                <FormField
                                                                    control={transactionForm.control}
                                                                    name={`items.${index}.product_id`}
                                                                    render={({ field }) => (
                                                                        <FormItem className="space-y-1">
                                                                            <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground/60 flex items-center gap-1.5"><Package className="w-3 h-3" /> Product</FormLabel>
                                                                            <Select onValueChange={field.onChange} value={field.value || ''}>
                                                                                <FormControl>
                                                                                    <SelectTrigger className="h-12 rounded-2xl border-none bg-white text-base font-bold text-brand-navy shadow-sm">
                                                                                        <SelectValue placeholder="Select product" />
                                                                                    </SelectTrigger>
                                                                                </FormControl>
                                                                                <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                                                    {products?.map(p => (
                                                                                        <SelectItem key={p.id} value={p.id} className="rounded-xl font-medium">
                                                                                            {p.name} <span className="text-muted-foreground ml-2 text-xs">({p.code})</span>
                                                                                        </SelectItem>
                                                                                    ))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            ) : (
                                                                <FormField
                                                                    control={transactionForm.control}
                                                                    name={`items.${index}.accessory_id`}
                                                                    render={({ field }) => (
                                                                        <FormItem className="space-y-1">
                                                                            <FormLabel className="text-[10px] uppercase font-bold text-amber-700/60 flex items-center gap-1.5"><Puzzle className="w-3 h-3" /> Accessory</FormLabel>
                                                                            <Select onValueChange={field.onChange} value={field.value || ''}>
                                                                                <FormControl>
                                                                                    <SelectTrigger className="h-12 rounded-2xl border-none bg-white text-base font-bold text-brand-navy shadow-sm">
                                                                                        <SelectValue placeholder="Select accessory" />
                                                                                    </SelectTrigger>
                                                                                </FormControl>
                                                                                <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                                                    {accessories?.map(a => (
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
                                                            )}
                                                        </div>
                                                        <div className="md:col-span-2">
                                                            <FormField
                                                                control={transactionForm.control}
                                                                name={`items.${index}.quantity`}
                                                                render={({ field }) => (
                                                                    <FormItem className="space-y-1">
                                                                        <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground/60">Qty</FormLabel>
                                                                        <Input type="number" placeholder="0" {...field} className="h-12 rounded-2xl border-none bg-white text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-sm" />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </div>
                                                        <div className="md:col-span-3">
                                                            <FormField
                                                                control={transactionForm.control}
                                                                name={`items.${index}.unit_price`}
                                                                render={({ field }) => (
                                                                    <FormItem className="space-y-1">
                                                                        <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground/60">Unit Cost (DH)</FormLabel>
                                                                        <div className="relative">
                                                                            <Input type="number" step="0.01" placeholder="0" {...field} className="h-12 rounded-2xl border-none bg-white text-base font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium shadow-sm" />
                                                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-brand-navy/30">{lineSubtotal.toFixed(1)} DH</div>
                                                                        </div>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </div>
                                                        <div className="md:col-span-2 flex items-end gap-2">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => remove(index)}
                                                                disabled={fields.length === 1}
                                                                className="h-12 w-12 rounded-2xl text-red-400 hover:text-red-600 hover:bg-red-50"
                                                            >
                                                                <X className="w-5 h-5" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="p-6 rounded-[32px] bg-brand-navy/[0.02] border border-brand-navy/[0.03] flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-12 h-12 rounded-2xl bg-brand-navy flex items-center justify-center text-brand-white shadow-xl shadow-brand-navy/20">
                                                <DollarSign className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Grand Total Amount</p>
                                                <h3 className="text-2xl font-black text-brand-navy">
                                                    {transactionForm.watch('items').reduce((acc, item) => acc + (item.quantity * item.unit_price), 0).toFixed(2)} DH
                                                </h3>
                                            </div>
                                        </div>
                                        <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold px-4 py-2 rounded-xl">
                                            {editingTransactionId ? 'Edit invoice' : 'Invoice Draft'}
                                        </Badge>
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-8 pt-0 shrink-0 bg-brand-white">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setTransactionModalOpen(false);
                                        setEditingTransactionId(null);
                                        transactionForm.reset(defaultTransactionFormValues);
                                    }}
                                    className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-muted"
                                >
                                    Discard
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={createTransactionMutation.isPending || updateTransactionMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center gap-3"
                                >
                                    {(createTransactionMutation.isPending || updateTransactionMutation.isPending) && (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    )}
                                    {editingTransactionId ? 'Save changes' : 'Finalize & Update Stock'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Add Payment Modal */}
            <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
                <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col">
                    <Form {...paymentForm}>
                        <form onSubmit={paymentForm.handleSubmit(v => addPaymentMutation.mutate(v))} className="flex flex-col h-full">
                            <DialogHeader className="p-8 pb-4">
                                <DialogTitle className="text-3xl font-bold text-brand-navy text-center">Record Payment</DialogTitle>
                                <DialogDescription className="text-center">Add a payment tranche for {selectedTransaction?.name}.</DialogDescription>
                            </DialogHeader>

                            <div className="p-8 space-y-6">
                                <div className="p-6 rounded-[32px] bg-brand-navy/[0.04] text-center space-y-1">
                                    <p className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-widest">Remaining Balance</p>
                                    <h2 className="text-3xl font-black text-brand-navy">
                                        {(selectedTransaction?.total_price || 0) - (selectedTransaction?.paid_price || 0)} DH
                                    </h2>
                                </div>

                                <FormField
                                    control={paymentForm.control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2">
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70 text-center block">Amount to Pay</FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-2xl font-black text-brand-navy text-center shadow-inner" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={paymentForm.control}
                                        name="method"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Method</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] font-bold text-brand-navy">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl border-none shadow-2xl">
                                                        <SelectItem value="Cash" className="rounded-xl font-bold">Cash</SelectItem>
                                                        <SelectItem value="Bank Transfer" className="rounded-xl font-bold">Transfer</SelectItem>
                                                        <SelectItem value="Check" className="rounded-xl font-bold">Check</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={paymentForm.control}
                                        name="date"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Payment Date</FormLabel>
                                                <FormControl>
                                                    <Input type="date" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] font-bold text-brand-navy shadow-inner" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <DialogFooter className="p-8 pt-0 flex flex-col gap-3">
                                <Button
                                    type="submit"
                                    disabled={addPaymentMutation.isPending}
                                    className="w-full bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center justify-center gap-3"
                                >
                                    {addPaymentMutation.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                                    Confirm Payment
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsPaymentModalOpen(false)}
                                    className="w-full rounded-2xl h-14 font-bold text-brand-navy"
                                >
                                    Cancel
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    {selectedTransaction && (
                        <>
                            <DialogHeader className="p-10 pb-0">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-16 h-16 rounded-[24px] bg-brand-navy/[0.04] flex items-center justify-center text-brand-navy">
                                                <User className="w-8 h-8" />
                                            </div>
                                            <div>
                                                <h2 className="text-4xl font-black text-brand-navy tracking-tight">{selectedTransaction.name}</h2>
                                                <div className="flex items-center gap-4 text-muted-foreground font-bold text-sm tracking-wide">
                                                    <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {format(new Date(selectedTransaction.date), 'MMMM dd, yyyy')}</span>
                                                    {selectedTransaction.phone && <span className="flex items-center gap-1.5"><Phone className="w-4 h-4" /> {selectedTransaction.phone}</span>}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right space-y-2">
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Balance Status</p>
                                        {getStatusBadge(selectedTransaction)}
                                    </div>
                                </div>
                            </DialogHeader>

                            <div className="overflow-y-auto p-10 space-y-10 flex-1 min-h-0 custom-scrollbar">
                                {/* Dashboard Section */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="p-8 rounded-[32px] bg-brand-navy/[0.02] border border-brand-navy/[0.03] space-y-1 relative overflow-hidden group">
                                        <Receipt className="absolute -right-4 -bottom-4 w-24 h-24 text-brand-navy/5 transition-transform group-hover:scale-110" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60">Total Invoiced</p>
                                        <h3 className="text-3xl font-black text-brand-navy">{selectedTransaction.total_price || 0} DH</h3>
                                    </div>
                                    <div className="p-8 rounded-[32px] bg-emerald-50/50 border border-emerald-100 space-y-1 relative overflow-hidden group">
                                        <CheckCircle2 className="absolute -right-4 -bottom-4 w-24 h-24 text-emerald-500/5 transition-transform group-hover:scale-110" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600/60">Total Paid</p>
                                        <h3 className="text-3xl font-black text-emerald-600">{selectedTransaction.paid_price || 0} DH</h3>
                                    </div>
                                    <div className="p-8 rounded-[32px] bg-red-50/50 border border-red-100 space-y-1 relative overflow-hidden group">
                                        <Clock className="absolute -right-4 -bottom-4 w-24 h-24 text-red-500/5 transition-transform group-hover:scale-110" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-red-600/60">Outstanding</p>
                                        <h3 className="text-3xl font-black text-red-600">
                                            {(selectedTransaction.total_price || 0) - (selectedTransaction.paid_price || 0)} DH
                                        </h3>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                                    {/* Items History */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-2">
                                            <Package className="w-5 h-5 text-brand-navy" />
                                            <h4 className="text-lg font-black text-brand-navy uppercase tracking-widest flex-1">Order Items</h4>
                                            <Badge variant="outline" className="text-[10px] font-black border-brand-navy/10">{selectedTransaction.items?.length || 0} items</Badge>
                                        </div>
                                        <div className="space-y-4">
                                            {selectedTransaction.items?.map((item: any) => (
                                                <div key={item.id} className="p-6 rounded-[24px] bg-brand-navy/[0.02] border border-brand-navy/[0.03] space-y-3 group hover:bg-brand-navy/[0.04] transition-colors">
                                                    {item.product && (
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <Package className="w-3.5 h-3.5 text-brand-navy/40" />
                                                                    <h5 className="font-bold text-brand-navy">{item.product.name}</h5>
                                                                </div>
                                                                <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest ml-5">{item.product.code}</p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-sm font-black text-brand-navy">{item.quantity} units</p>
                                                                <p className="text-[10px] font-bold text-emerald-600 uppercase">+{item.sub_total} DH</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {item.accessory && (
                                                        <div className={cn("flex justify-between items-center", item.product && "border-t border-dashed border-brand-navy/[0.06] pt-3")}>
                                                            <div>
                                                                <div className="flex items-center gap-1.5">
                                                                    <Puzzle className="w-3.5 h-3.5 text-brand-navy/40" />
                                                                    <h5 className="font-bold text-brand-navy text-sm">{item.accessory.name}</h5>
                                                                </div>
                                                                <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest ml-5">{item.accessory.code}</p>
                                                            </div>
                                                            <div className="text-right">
                                                                <p className="text-sm font-black text-brand-navy">{item.accessory_quantity} units</p>
                                                                <p className="text-[10px] font-bold text-emerald-600 uppercase">+{item.accessory_sub_total} DH</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Payment History */}
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-2">
                                            <History className="w-5 h-5 text-brand-navy" />
                                            <h4 className="text-lg font-black text-brand-navy uppercase tracking-widest flex-1">Payment Log</h4>
                                        </div>
                                        <div className="space-y-4">
                                            {selectedTransaction.payments?.length === 0 ? (
                                                <div className="p-10 rounded-[24px] border-2 border-dashed border-brand-navy/10 flex flex-col items-center justify-center text-center opacity-60">
                                                    <Wallet className="w-10 h-10 text-brand-navy/20 mb-3" />
                                                    <p className="text-xs font-bold text-brand-navy italic uppercase tracking-widest">No payments recorded yet</p>
                                                </div>
                                            ) : (
                                                selectedTransaction.payments?.map((payment: any) => (
                                                    <div key={payment.id} className="p-6 rounded-[24px] bg-emerald-50/30 border border-emerald-100 flex justify-between items-center animate-in slide-in-from-right-2 duration-300">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600">
                                                                <CheckCircle2 className="w-5 h-5" />
                                                            </div>
                                                            <div>
                                                                <h5 className="font-bold text-emerald-900">{payment.method}</h5>
                                                                <p className="text-[10px] font-black text-emerald-600/60 uppercase tracking-widest">{format(new Date(payment.date), 'MMM dd, HH:mm')}</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <p className="text-lg font-black text-emerald-600">-{payment.amount} DH</p>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {selectedTransaction.note && (
                                    <div className="p-6 rounded-[24px] bg-brand-navy/[0.04] border-l-4 border-brand-navy">
                                        <h5 className="text-[10px] font-black uppercase text-brand-navy mb-2 tracking-widest">Order Note</h5>
                                        <p className="text-brand-navy font-medium italic">"{selectedTransaction.note}"</p>
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="p-10 pt-0 shrink-0 flex flex-col gap-3 sm:flex-row sm:justify-end">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => {
                                        const t = selectedTransaction;
                                        setIsViewModalOpen(false);
                                        setEditingTransactionId(t.id);
                                        transactionForm.reset(mapTransactionToFormValues(t));
                                        setTransactionModalOpen(true);
                                    }}
                                    className="order-2 h-14 rounded-2xl border-brand-navy/20 px-8 font-bold text-brand-navy hover:bg-brand-navy/[0.06] sm:order-1"
                                >
                                    <Pencil className="mr-2 h-5 w-5" />
                                    Edit transaction
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => {
                                        setIsViewModalOpen(false);
                                        paymentForm.setValue(
                                            'amount',
                                            (selectedTransaction.total_price || 0) - (selectedTransaction.paid_price || 0)
                                        );
                                        setIsPaymentModalOpen(true);
                                    }}
                                    className="order-1 flex w-full items-center gap-3 rounded-2xl bg-brand-navy px-10 py-4 font-bold text-white shadow-2xl shadow-brand-navy/30 transition-all hover:bg-brand-navy/90 active:scale-95 sm:order-2 sm:w-auto"
                                >
                                    <Wallet className="h-5 w-5" />
                                    Make a Payment for this Order
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col">
                    <DialogHeader className="p-8 pb-4">
                        <DialogTitle className="text-3xl font-black text-brand-navy">Delete Transaction</DialogTitle>
                        <DialogDescription className="text-base font-medium">
                            Are you sure you want to delete this transaction record? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="p-8 pt-0 flex gap-3">
                        <Button
                            variant="ghost"
                            onClick={() => setIsDeleteDialogOpen(false)}
                            className="w-full rounded-2xl h-14 font-bold text-brand-navy hover:bg-muted"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                if (selectedTransaction) {
                                    deleteTransactionMutation.mutate(selectedTransaction.id);
                                }
                            }}
                            disabled={deleteTransactionMutation.isPending}
                            className="w-full bg-red-500 hover:bg-red-600 text-white rounded-2xl h-14 font-bold shadow-2xl transition-all flex items-center justify-center gap-2"
                        >
                            {deleteTransactionMutation.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                            Yes, Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Transactions;
