import React, { useMemo, useState, useRef } from 'react';
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
    ChevronsUpDown,
    Check,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command,
    CommandInput,
    CommandList,
    CommandEmpty,
    CommandGroup,
    CommandItem,
} from "@/components/ui/command";

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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Supplier Transactions</h1>
                    <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Inventory purchases &amp; payments ledger</p>
                </div>
                <Button
                    onClick={() => {
                        setEditingTransactionId(null);
                        transactionForm.reset(defaultTransactionFormValues);
                        setTransactionModalOpen(true);
                    }}
                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                >
                    <PlusCircle className="w-3.5 h-3.5" />
                    New Purchase
                </Button>
            </header>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                <div className="relative flex-1 min-w-0 max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                    <Input
                        placeholder="Search supplier or phone..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px]"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex gap-0.5 bg-white p-0.5 rounded-md border border-gray-200 shrink-0">
                        {(['all', 'paid', 'partial', 'unpaid'] as const).map(s => (
                            <button
                                key={s}
                                onClick={() => setStatusFilter(s)}
                                className={cn(
                                    "px-2 h-7 rounded-[4px] text-[10px] font-semibold transition capitalize",
                                    statusFilter === s ? "bg-brand-navy text-white" : "text-gray-500 hover:text-brand-navy hover:bg-gray-50"
                                )}
                            >
                                {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                            </button>
                        ))}
                    </div>
                    <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
                        <SelectTrigger className="h-8 w-[130px] rounded-md border-gray-200 text-[11px]">
                            <SelectValue placeholder="Sort" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="newest">Newest first</SelectItem>
                            <SelectItem value="oldest">Oldest first</SelectItem>
                        </SelectContent>
                    </Select>
                    <div className="flex gap-0.5 bg-white p-0.5 rounded-md border border-gray-200 shrink-0">
                        <button
                            onClick={() => setViewMode('list')}
                            className={cn("px-2.5 h-7 rounded-[4px] text-[10px] font-semibold transition flex items-center gap-1", viewMode === 'list' ? "bg-brand-navy text-white" : "text-gray-500 hover:text-brand-navy hover:bg-gray-50")}
                        >
                            <LayoutList className="w-3 h-3" /> List
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            className={cn("px-2.5 h-7 rounded-[4px] text-[10px] font-semibold transition flex items-center gap-1", viewMode === 'grid' ? "bg-brand-navy text-white" : "text-gray-500 hover:text-brand-navy hover:bg-gray-50")}
                        >
                            <LayoutGrid className="w-3 h-3" /> Grid
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}</div>
            ) : displayTransactions.length === 0 ? (
                <div className="border border-dashed border-gray-200 rounded-xl py-8 text-center">
                    <p className="text-[14px] font-semibold text-brand-navy">No transactions found</p>
                    <p className="text-[11px] text-gray-400 mt-1">
                        {transactions?.length ? 'Try adjusting search or filters.' : 'Start logging your supplier purchases.'}
                    </p>
                </div>
            ) : viewMode === 'list' ? (
                <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Supplier</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Date</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Total</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Balance</th>
                                    <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Status</th>
                                    <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayTransactions.map((tx) => {
                                    const balance = (tx.total_price || 0) - (tx.paid_price || 0);
                                    return (
                                        <tr key={tx.id} className="hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0">
                                            <td className="px-3 py-2">
                                                <p className="text-[12px] font-semibold text-brand-navy truncate">{tx.name}</p>
                                                {tx.phone && <p className="text-[10px] text-gray-500 font-mono">{tx.phone}</p>}
                                            </td>
                                            <td className="px-3 py-2 text-[10px] text-gray-500 tabular-nums whitespace-nowrap">
                                                {format(new Date(tx.date || tx.created_at), 'MMM dd, yyyy')}
                                            </td>
                                            <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums">{tx.total_price || 0} DH</td>
                                            <td className={cn("px-3 py-2 text-right text-[11px] font-semibold tabular-nums", balance > 0 ? "text-red-500" : "text-emerald-600")}>
                                                {balance} DH
                                            </td>
                                            <td className="px-3 py-2">{getStatusBadge(tx)}</td>
                                            <td className="px-3 py-2">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button type="button" variant="ghost" size="icon" title="View" onClick={() => { setSelectedTransaction(tx); setIsViewModalOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-brand-navy/5">
                                                        <Eye className="h-3.5 w-3.5 text-brand-navy/60" />
                                                    </Button>
                                                    <Button type="button" variant="ghost" size="icon" title="Edit" onClick={() => { setEditingTransactionId(tx.id); transactionForm.reset(mapTransactionToFormValues(tx)); setTransactionModalOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-amber-50">
                                                        <Pencil className="h-3.5 w-3.5 text-amber-600" />
                                                    </Button>
                                                    <Button type="button" variant="ghost" size="icon" title="Record payment" onClick={() => { setSelectedTransaction(tx); paymentForm.setValue('amount', balance); setIsPaymentModalOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-emerald-50">
                                                        <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                                                    </Button>
                                                    <Button type="button" variant="ghost" size="icon" title="Delete" onClick={() => { setSelectedTransaction(tx); setIsDeleteDialogOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-red-50">
                                                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {displayTransactions.map((tx) => {
                        const balance = (tx.total_price || 0) - (tx.paid_price || 0);
                        return (
                            <div key={tx.id} className="rounded-xl border border-gray-100 bg-white p-3.5 flex flex-col gap-2.5">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-[12px] font-semibold text-brand-navy truncate">{tx.name}</p>
                                        <p className="text-[10px] text-gray-500 tabular-nums">{format(new Date(tx.date || tx.created_at), 'MMM dd, yyyy')}</p>
                                    </div>
                                    {getStatusBadge(tx)}
                                </div>
                                <div className="flex gap-4">
                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total</p>
                                        <p className="text-[15px] font-semibold text-brand-navy tabular-nums">{tx.total_price || 0} DH</p>
                                    </div>
                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Balance</p>
                                        <p className={cn("text-[15px] font-semibold tabular-nums", balance > 0 ? "text-red-500" : "text-emerald-600")}>{balance} DH</p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between border-t border-gray-100 pt-2">
                                    <p className="text-[10px] text-gray-400">{tx.items?.length || 0} items · {tx.payments?.length || 0} payments</p>
                                    <div className="flex items-center gap-1">
                                        <Button type="button" variant="ghost" size="icon" title="View" onClick={() => { setSelectedTransaction(tx); setIsViewModalOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-brand-navy/5">
                                            <Eye className="h-3.5 w-3.5 text-brand-navy/60" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" title="Edit" onClick={() => { setEditingTransactionId(tx.id); transactionForm.reset(mapTransactionToFormValues(tx)); setTransactionModalOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-amber-50">
                                            <Pencil className="h-3.5 w-3.5 text-amber-600" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" title="Pay" onClick={() => { setSelectedTransaction(tx); paymentForm.setValue('amount', balance); setIsPaymentModalOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-emerald-50">
                                            <Wallet className="h-3.5 w-3.5 text-emerald-600" />
                                        </Button>
                                        <Button type="button" variant="ghost" size="icon" title="Delete" onClick={() => { setSelectedTransaction(tx); setIsDeleteDialogOpen(true); }} className="h-7 w-7 p-0 rounded-md hover:bg-red-50">
                                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
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
                <DialogContent className="max-w-4xl p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden flex flex-col max-h-[90vh]">
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
                            <DialogHeader className="px-4 pt-4 pb-3 shrink-0 border-b border-gray-100">
                                <DialogTitle className="text-[13px] font-semibold text-brand-navy">
                                    {editingTransactionId ? 'Edit purchase transaction' : 'New Purchase Transaction'}
                                </DialogTitle>
                                <DialogDescription className="text-[10px] text-gray-400">
                                    {editingTransactionId
                                        ? 'Update supplier details, dates, and line items. Payments on this transaction are unchanged.'
                                        : 'Log supplier invoices and update inventory stock instantly.'}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-4 space-y-4 flex-1 min-h-0">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Supplier Profile</p>
                                        <div className="grid grid-cols-1 gap-3">
                                            <FormField
                                                control={transactionForm.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Supplier Name</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                                                                <Input placeholder="E.g. Global Supplies Ltd" {...field} className="pl-8 h-8 rounded-md border-gray-200 text-[11px]" />
                                                            </div>
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            <div className="grid grid-cols-2 gap-3">
                                                <FormField
                                                    control={transactionForm.control}
                                                    name="phone"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-1.5">
                                                            <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Phone</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="+212..." {...field} className="h-8 rounded-md border-gray-200 text-[11px]" />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={transactionForm.control}
                                                    name="date"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-1.5">
                                                            <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Transaction Date</FormLabel>
                                                            <FormControl>
                                                                <Input type="date" {...field} className="h-8 rounded-md border-gray-200 text-[11px]" />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Logistics &amp; Notes</p>
                                        <div className="grid grid-cols-1 gap-3">
                                            <FormField
                                                control={transactionForm.control}
                                                name="address"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Supplier Address</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Warehouse location..." {...field} className="h-8 rounded-md border-gray-200 text-[11px]" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={transactionForm.control}
                                                name="note"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Internal Notes</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Extra details about this order..." {...field} className="h-8 rounded-md border-gray-200 text-[11px]" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Invoice Items</p>
                                        <div className="flex gap-1.5">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => append({ type: 'product' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 })}
                                                className="h-8 px-3 rounded-md text-[11px] font-semibold text-brand-navy hover:bg-brand-navy/[0.05] gap-1.5"
                                            >
                                                <Package className="w-3.5 h-3.5" /> Add Product
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => append({ type: 'accessory' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 })}
                                                className="h-8 px-3 rounded-md text-[11px] font-semibold text-amber-700 hover:bg-amber-50 gap-1.5"
                                            >
                                                <Puzzle className="w-3.5 h-3.5" /> Add Accessory
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        {fields.map((field, index) => {
                                            const itemType = transactionForm.watch(`items.${index}.type`);
                                            const lineSubtotal = (transactionForm.watch(`items.${index}.quantity`) || 0) * (transactionForm.watch(`items.${index}.unit_price`) || 0);
                                            const isProduct = itemType === 'product';
                                            return (
                                                <div key={field.id} className={cn(
                                                    "p-3 rounded-xl border space-y-1",
                                                    isProduct
                                                        ? "bg-brand-navy/[0.015] border-gray-100"
                                                        : "bg-amber-50/50 border-amber-100"
                                                )}>
                                                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                                                        <div className="md:col-span-5">
                                                            {isProduct ? (
                                                                <FormField
                                                                    control={transactionForm.control}
                                                                    name={`items.${index}.product_id`}
                                                                    render={({ field }) => {
                                                                        const selectedProduct = products?.find(p => p.id === field.value);
                                                                        return (
                                                                        <FormItem className="space-y-1">
                                                                            <FormLabel className="text-[9px] uppercase font-bold text-gray-400 flex items-center gap-1"><Package className="w-3 h-3" /> Product</FormLabel>
                                                                            <Popover modal={true}>
                                                                                <PopoverTrigger asChild>
                                                                                    <FormControl>
                                                                                        <Button
                                                                                            variant="outline"
                                                                                            role="combobox"
                                                                                            className={cn(
                                                                                                "h-8 w-full justify-between rounded-md border-gray-200 text-[11px] font-semibold text-brand-navy",
                                                                                                !field.value && "text-gray-400 font-normal"
                                                                                            )}
                                                                                        >
                                                                                            <span className="truncate">
                                                                                                {selectedProduct ? selectedProduct.name : "Select product"}
                                                                                            </span>
                                                                                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                                        </Button>
                                                                                    </FormControl>
                                                                                </PopoverTrigger>
                                                                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl border border-gray-100 shadow-md" align="start">
                                                                                    <Command>
                                                                                        <CommandInput placeholder="Search products..." className="h-8 text-[11px]" />
                                                                                        <CommandList className="max-h-[200px] overflow-y-auto">
                                                                                            <CommandEmpty>No product found.</CommandEmpty>
                                                                                            <CommandGroup>
                                                                                                {products?.map(p => (
                                                                                                    <CommandItem
                                                                                                        key={p.id}
                                                                                                        value={`${p.name} ${p.code}`}
                                                                                                        onSelect={() => {
                                                                                                            field.onChange(p.id);
                                                                                                        }}
                                                                                                        className="text-[11px] cursor-pointer"
                                                                                                    >
                                                                                                        <Check className={cn("mr-2 h-3 w-3", field.value === p.id ? "opacity-100" : "opacity-0")} />
                                                                                                        {p.name}
                                                                                                        <span className="text-gray-400 ml-2 text-[10px]">({p.code})</span>
                                                                                                    </CommandItem>
                                                                                                ))}
                                                                                            </CommandGroup>
                                                                                        </CommandList>
                                                                                    </Command>
                                                                                </PopoverContent>
                                                                            </Popover>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                        );
                                                                    }}
                                                                />
                                                            ) : (
                                                                <FormField
                                                                    control={transactionForm.control}
                                                                    name={`items.${index}.accessory_id`}
                                                                    render={({ field }) => {
                                                                        const selectedAccessory = accessories?.find(a => a.id === field.value);
                                                                        return (
                                                                        <FormItem className="space-y-1">
                                                                            <FormLabel className="text-[9px] uppercase font-bold text-amber-600 flex items-center gap-1"><Puzzle className="w-3 h-3" /> Accessory</FormLabel>
                                                                            <Popover modal={true}>
                                                                                <PopoverTrigger asChild>
                                                                                    <FormControl>
                                                                                        <Button
                                                                                            variant="outline"
                                                                                            role="combobox"
                                                                                            className={cn(
                                                                                                "h-8 w-full justify-between rounded-md border-gray-200 text-[11px] font-semibold text-brand-navy",
                                                                                                !field.value && "text-gray-400 font-normal"
                                                                                            )}
                                                                                        >
                                                                                            <span className="truncate">
                                                                                                {selectedAccessory ? selectedAccessory.name : "Select accessory"}
                                                                                            </span>
                                                                                            <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                                        </Button>
                                                                                    </FormControl>
                                                                                </PopoverTrigger>
                                                                                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl border border-gray-100 shadow-md" align="start">
                                                                                    <Command>
                                                                                        <CommandInput placeholder="Search accessories..." className="h-8 text-[11px]" />
                                                                                        <CommandList className="max-h-[200px] overflow-y-auto">
                                                                                            <CommandEmpty>No accessory found.</CommandEmpty>
                                                                                            <CommandGroup>
                                                                                                {accessories?.map(a => (
                                                                                                    <CommandItem
                                                                                                        key={a.id}
                                                                                                        value={`${a.name} ${a.code}`}
                                                                                                        onSelect={() => {
                                                                                                            field.onChange(a.id);
                                                                                                        }}
                                                                                                        className="text-[11px] cursor-pointer"
                                                                                                    >
                                                                                                        <Check className={cn("mr-2 h-3 w-3", field.value === a.id ? "opacity-100" : "opacity-0")} />
                                                                                                        {a.name}
                                                                                                        <span className="text-gray-400 ml-2 text-[10px]">({a.code})</span>
                                                                                                    </CommandItem>
                                                                                                ))}
                                                                                            </CommandGroup>
                                                                                        </CommandList>
                                                                                    </Command>
                                                                                </PopoverContent>
                                                                            </Popover>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                        );
                                                                    }}
                                                                />
                                                            )}
                                                        </div>
                                                        <div className="md:col-span-2">
                                                            <FormField
                                                                control={transactionForm.control}
                                                                name={`items.${index}.quantity`}
                                                                render={({ field }) => (
                                                                    <FormItem className="space-y-1">
                                                                        <FormLabel className="text-[9px] uppercase font-bold text-gray-400">Qty</FormLabel>
                                                                        <Input type="number" placeholder="0" {...field} className="h-8 rounded-md border-gray-200 text-[11px]" />
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
                                                                        <FormLabel className="text-[9px] uppercase font-bold text-gray-400">Unit Cost (DH)</FormLabel>
                                                                        <div className="relative">
                                                                            <Input type="number" step="0.01" placeholder="0" {...field} className="h-8 rounded-md border-gray-200 text-[11px] pr-16" />
                                                                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-gray-400">{lineSubtotal.toFixed(1)} DH</div>
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
                                                                className="h-8 w-8 rounded-md text-red-400 hover:text-red-600 hover:bg-red-50"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                                        <div>
                                            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Grand Total</p>
                                            <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-0.5">
                                                {transactionForm.watch('items').reduce((acc, item) => acc + (item.quantity * item.unit_price), 0).toFixed(2)} DH
                                            </p>
                                        </div>
                                        <span className="h-5 px-1.5 rounded text-[9px] font-bold uppercase tracking-[0.08em] inline-flex items-center bg-emerald-50 text-emerald-600">
                                            {editingTransactionId ? 'Edit invoice' : 'Invoice Draft'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="px-4 py-3 shrink-0 border-t border-gray-100 gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setTransactionModalOpen(false);
                                        setEditingTransactionId(null);
                                        transactionForm.reset(defaultTransactionFormValues);
                                    }}
                                    className="h-8 px-3 rounded-md text-[11px] font-semibold text-brand-navy hover:bg-gray-100"
                                >
                                    Discard
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={createTransactionMutation.isPending || updateTransactionMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-4 rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {(createTransactionMutation.isPending || updateTransactionMutation.isPending) && (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
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
                <DialogContent className="max-w-md p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden flex flex-col">
                    <Form {...paymentForm}>
                        <form onSubmit={paymentForm.handleSubmit(v => addPaymentMutation.mutate(v))} className="flex flex-col h-full">
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                                <DialogTitle className="text-[13px] font-semibold text-brand-navy">Record Payment</DialogTitle>
                                <DialogDescription className="text-[10px] text-gray-400">Add a payment tranche for {selectedTransaction?.name}.</DialogDescription>
                            </DialogHeader>

                            <div className="p-4 space-y-3">
                                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#ef4444' }} />
                                    <div>
                                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Remaining Balance</p>
                                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">
                                            {(selectedTransaction?.total_price || 0) - (selectedTransaction?.paid_price || 0)} DH
                                        </p>
                                    </div>
                                </div>

                                <FormField
                                    control={paymentForm.control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1.5">
                                            <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Amount to Pay</FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" {...field} className="h-8 rounded-md border-gray-200 text-[11px]" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={paymentForm.control}
                                        name="method"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Method</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-8 rounded-md border-gray-200 text-[11px]">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="Cash">Cash</SelectItem>
                                                        <SelectItem value="Bank Transfer">Transfer</SelectItem>
                                                        <SelectItem value="Check">Check</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={paymentForm.control}
                                        name="date"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400">Payment Date</FormLabel>
                                                <FormControl>
                                                    <Input type="date" {...field} className="h-8 rounded-md border-gray-200 text-[11px]" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <DialogFooter className="px-4 py-3 border-t border-gray-100 gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsPaymentModalOpen(false)}
                                    className="h-8 px-3 rounded-md text-[11px] font-semibold text-brand-navy hover:bg-gray-100"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={addPaymentMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-4 rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {addPaymentMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    Confirm Payment
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden flex flex-col max-h-[90vh]">
                    {selectedTransaction && (
                        <>
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <DialogTitle className="text-[13px] font-semibold text-brand-navy truncate">{selectedTransaction.name}</DialogTitle>
                                        <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-400">
                                            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(new Date(selectedTransaction.date), 'MMM dd, yyyy')}</span>
                                            {selectedTransaction.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {selectedTransaction.phone}</span>}
                                        </div>
                                    </div>
                                    {getStatusBadge(selectedTransaction)}
                                </div>
                            </DialogHeader>

                            <div className="overflow-y-auto p-4 space-y-4 flex-1 min-h-0">
                                {/* KPI tiles */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                    {[
                                        { label: 'Total Invoiced', value: `${selectedTransaction.total_price || 0} DH`, accent: '#3b5e5e' },
                                        { label: 'Total Paid', value: `${selectedTransaction.paid_price || 0} DH`, accent: '#059669' },
                                        { label: 'Outstanding', value: `${(selectedTransaction.total_price || 0) - (selectedTransaction.paid_price || 0)} DH`, accent: '#ef4444' },
                                    ].map((s) => (
                                        <div key={s.label} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                                            <span className="w-[3px] self-stretch rounded-full" style={{ background: s.accent }} />
                                            <div>
                                                <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{s.label}</p>
                                                <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{s.value}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {/* Items */}
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Order Items</p>
                                            <span className="h-5 px-1.5 bg-gray-100 rounded text-[9px] font-bold text-gray-500 inline-flex items-center">{selectedTransaction.items?.length || 0}</span>
                                        </div>
                                        <div className="rounded-xl border border-gray-100 overflow-hidden">
                                            {selectedTransaction.items?.map((item: any) => (
                                                <div key={item.id} className="px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
                                                    {item.product && (
                                                        <div className="flex justify-between items-center">
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <Package className="w-3 h-3 text-gray-400 shrink-0" />
                                                                <div className="min-w-0">
                                                                    <p className="text-[11px] font-semibold text-brand-navy truncate">{item.product.name}</p>
                                                                    <p className="text-[9px] text-gray-400">{item.product.code}</p>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 ml-2">
                                                                <p className="text-[11px] font-semibold text-brand-navy tabular-nums">{item.quantity} units</p>
                                                                <p className="text-[9px] text-emerald-600 tabular-nums">+{item.sub_total} DH</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {item.accessory && (
                                                        <div className={cn("flex justify-between items-center", item.product && "border-t border-gray-100 mt-2 pt-2")}>
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <Puzzle className="w-3 h-3 text-gray-400 shrink-0" />
                                                                <div className="min-w-0">
                                                                    <p className="text-[11px] font-semibold text-brand-navy truncate">{item.accessory.name}</p>
                                                                    <p className="text-[9px] text-gray-400">{item.accessory.code}</p>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 ml-2">
                                                                <p className="text-[11px] font-semibold text-brand-navy tabular-nums">{item.accessory_quantity} units</p>
                                                                <p className="text-[9px] text-emerald-600 tabular-nums">+{item.accessory_sub_total} DH</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Payment History */}
                                    <div className="space-y-2">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">Payment Log</p>
                                        {selectedTransaction.payments?.length === 0 ? (
                                            <div className="border border-dashed border-gray-200 rounded-xl py-6 text-center">
                                                <Wallet className="w-5 h-5 text-gray-300 mx-auto mb-1" />
                                                <p className="text-[11px] text-gray-400">No payments recorded yet</p>
                                            </div>
                                        ) : (
                                            <div className="rounded-xl border border-gray-100 overflow-hidden">
                                                {selectedTransaction.payments?.map((payment: any) => (
                                                    <div key={payment.id} className="px-3 py-2 border-b border-gray-100 last:border-0 flex justify-between items-center hover:bg-gray-50 transition-colors">
                                                        <div>
                                                            <p className="text-[11px] font-semibold text-brand-navy">{payment.method}</p>
                                                            <p className="text-[9px] text-gray-400 tabular-nums">{format(new Date(payment.date), 'MMM dd, HH:mm')}</p>
                                                        </div>
                                                        <p className="text-[12px] font-semibold text-emerald-600 tabular-nums">-{payment.amount} DH</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {selectedTransaction.note && (
                                    <div className="p-3 rounded-xl border-l-4 border-brand-navy bg-brand-navy/[0.02]">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400 mb-1">Order Note</p>
                                        <p className="text-[11px] text-brand-navy/80 italic">"{selectedTransaction.note}"</p>
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="px-4 py-3 border-t border-gray-100 gap-2 flex-row justify-end">
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
                                    className="h-8 px-3 rounded-md border-gray-200 text-[11px] font-semibold text-brand-navy gap-1.5"
                                >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Edit
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
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-4 rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    <Wallet className="h-3.5 w-3.5" />
                                    Record Payment
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent className="max-w-md p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden flex flex-col">
                    <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                        <DialogTitle className="text-[13px] font-semibold text-brand-navy">Delete Transaction</DialogTitle>
                        <DialogDescription className="text-[10px] text-gray-400">
                            Are you sure you want to delete this transaction record? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="px-4 py-3 gap-2">
                        <Button
                            variant="ghost"
                            onClick={() => setIsDeleteDialogOpen(false)}
                            className="h-8 px-3 rounded-md text-[11px] font-semibold text-brand-navy hover:bg-gray-100"
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
                            className="h-8 px-3 rounded-md bg-red-500 hover:bg-red-600 text-white text-[11px] font-semibold gap-1.5"
                        >
                            {deleteTransactionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Yes, Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Transactions;
