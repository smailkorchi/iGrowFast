import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import {
    Search,
    Wallet,
    Trash2,
    Loader2,
    User,
    Phone,
    Calendar,
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
    BookOpen,
    Receipt,
    BadgeDollarSign,
    Sparkles,
    type LucideIcon,
} from 'lucide-react';


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
import { Skeleton } from "@/components/ui/skeleton";
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

const TX_KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

interface TxKpiProps {
    label: string;
    value: string;
    suffix: string;
    accent: keyof typeof TX_KPI_ACCENTS;
    icon: LucideIcon;
}

const TxKpi: React.FC<TxKpiProps> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = TX_KPI_ACCENTS[accent];
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
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2">
                {value}
                <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span>
            </p>
        </div>
    );
};

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
    const [paymentToDelete, setPaymentToDelete] = useState<any>(null);
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
            // fetchAllRows paginates past the PostgREST 1000-row cap so the
            // ledger stays complete; pages come back id-ordered (stable) and
            // displayTransactions re-sorts by date for the UI.
            return fetchAllRows<any>(
                'transactions',
                `
                    *,
                    items:trns_purchase(*, product:products(name, code), accessory:accessories(name, code)),
                    payments:trns_payment(*)
                `,
                { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }] }
            );
        },
    });

    // Server-side money KPIs + status counts — must never depend on how many
    // rows the client happened to receive. Lives under the ['transactions', biz]
    // prefix so every mutation invalidation refreshes it.
    const { data: txTotals } = useQuery({
        queryKey: ['transactions', activeBusinessId, 'totals'],
        queryFn: async () => {
            const { data, error } = await (supabase as any).rpc('transactions_totals', {
                p_business: activeBusinessId,
            });
            if (error) throw error;
            return data as {
                invoiced: number;
                paid: number;
                outstanding: number;
                count_all: number;
                count_paid: number;
                count_partial: number;
                count_unpaid: number;
            };
        },
        enabled: !!activeBusinessId,
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

    const deletePaymentMutation = useMutation({
        mutationFn: async (paymentId: string) => {
            const { error } = await supabase
                .from('trns_payment')
                .delete()
                .eq('id', paymentId)
                .eq('DigiCom Business', activeBusinessId);

            if (error) throw error;
            return paymentId;
        },
        onSuccess: (paymentId) => {
            queryClient.invalidateQueries({ queryKey: ['transactions', activeBusinessId] });
            setSelectedTransaction((prev: any) =>
                prev
                    ? { ...prev, payments: (prev.payments || []).filter((p: any) => p.id !== paymentId) }
                    : prev
            );
            setPaymentToDelete(null);
            toast({ title: "Payment Removed", description: "Ledger entry deleted." });
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
        const status = getPaymentStatus(tx);
        const map = {
            paid: { dot: 'bg-ant-green', text: 'text-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', label: 'Paid' },
            partial: { dot: 'bg-ant-orange', text: 'text-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', label: 'Partial' },
            unpaid: { dot: 'bg-ant-rose', text: 'text-ant-rose', bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', label: 'Unpaid' },
        } as const;
        const s = map[status];
        return (
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', s.bg, s.border, s.text)}>
                <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                {s.label}
            </span>
        );
    };

    // KPI money + status counts come from the transactions_totals RPC
    // (server-side aggregate, immune to the 1000-row PostgREST cap). The RPC
    // replicates getPaymentStatus() exactly on the server.
    const totals = useMemo(() => ({
        invoiced: Number(txTotals?.invoiced ?? 0),
        paid: Number(txTotals?.paid ?? 0),
        outstanding: Number(txTotals?.outstanding ?? 0),
    }), [txTotals]);

    const tabCounts = useMemo(() => ({
        all: Number(txTotals?.count_all ?? 0),
        paid: Number(txTotals?.count_paid ?? 0),
        partial: Number(txTotals?.count_partial ?? 0),
        unpaid: Number(txTotals?.count_unpaid ?? 0),
    }), [txTotals]);

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Ledger · Suppliers
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Supplier transactions
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every invoice, every payment, every outstanding balance — recorded as a ledger, not a task list.
                        </p>
                    </div>
                    <Button
                        onClick={() => {
                            setEditingTransactionId(null);
                            transactionForm.reset(defaultTransactionFormValues);
                            setTransactionModalOpen(true);
                        }}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <PlusCircle className="w-4 h-4" />
                        New purchase
                    </Button>
                </header>

                {/* KPI strip */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    <TxKpi label="Transactions" value={tabCounts.all.toString()} suffix="records" accent="ink" icon={BookOpen} />
                    <TxKpi label="Invoiced" value={Math.round(totals.invoiced).toLocaleString()} suffix="DH" accent="orange" icon={Receipt} />
                    <TxKpi label="Paid" value={Math.round(totals.paid).toLocaleString()} suffix="DH" accent="green" icon={BadgeDollarSign} />
                    <TxKpi label="Outstanding" value={Math.round(totals.outstanding).toLocaleString()} suffix="DH" accent="rose" icon={Wallet} />
                </section>

                {/* Tabs + toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto">
                        {([
                            { key: 'all', label: 'All' },
                            { key: 'paid', label: 'Paid' },
                            { key: 'partial', label: 'Partial' },
                            { key: 'unpaid', label: 'Unpaid' },
                        ] as const).map((t) => {
                            const active = statusFilter === t.key;
                            const count = tabCounts[t.key];
                            return (
                                <button
                                    key={t.key}
                                    onClick={() => setStatusFilter(t.key)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                    )}
                                >
                                    {t.label}
                                    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', active ? 'bg-white/20 text-white' : 'bg-ant-light text-ant-mid')}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="relative flex-1 min-w-0 md:w-[280px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                            <Input
                                placeholder="Search supplier or phone..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 h-9 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                            />
                        </div>
                        <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as typeof sortOrder)}>
                            <SelectTrigger className="h-9 w-[140px] rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink">
                                <SelectValue placeholder="Sort" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-ant-line">
                                <SelectItem value="newest" className="text-[12px]">Newest first</SelectItem>
                                <SelectItem value="oldest" className="text-[12px]">Oldest first</SelectItem>
                            </SelectContent>
                        </Select>
                        <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper shrink-0">
                            <button
                                onClick={() => setViewMode('list')}
                                className={cn('inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-semibold transition cursor-pointer', viewMode === 'list' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink')}
                            >
                                <LayoutList className="w-3 h-3" /> List
                            </button>
                            <button
                                onClick={() => setViewMode('grid')}
                                className={cn('inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-semibold transition cursor-pointer', viewMode === 'grid' ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink')}
                            >
                                <LayoutGrid className="w-3 h-3" /> Grid
                            </button>
                        </div>
                    </div>
                </div>

                {/* Content */}
                {isLoading ? (
                    <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
                ) : displayTransactions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <BookOpen className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">No transactions yet</h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {transactions?.length ? 'No record matches your filters — relax the search or try a different status.' : 'Record the first supplier invoice to begin writing your ledger.'}
                        </p>
                        {!transactions?.length && (
                            <Button
                                onClick={() => {
                                    setEditingTransactionId(null);
                                    transactionForm.reset(defaultTransactionFormValues);
                                    setTransactionModalOpen(true);
                                }}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <PlusCircle className="w-4 h-4" />
                                Record first purchase
                            </Button>
                        )}
                    </div>
                ) : viewMode === 'list' ? (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Supplier</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Date</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Invoiced</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Paid</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Outstanding</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Status</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] text-ant-mid font-semibold">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayTransactions.map((tx) => {
                                        const balance = (tx.total_price || 0) - (tx.paid_price || 0);
                                        return (
                                            <tr key={tx.id} className="hover:bg-ant-light/60 transition-colors border-b border-ant-line last:border-0">
                                                <td className="px-4 py-3">
                                                    <p className="text-[13px] font-semibold text-ant-ink truncate">{tx.name}</p>
                                                    {tx.phone && <p className="text-[11px] text-ant-mid tabular-nums">{tx.phone}</p>}
                                                </td>
                                                <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums whitespace-nowrap">
                                                    {format(new Date(tx.date || tx.created_at), 'MMM dd, yyyy')}
                                                </td>
                                                <td className="px-4 py-3 text-right text-[13px] font-semibold text-ant-ink tabular-nums">{tx.total_price || 0} <span className="text-ant-mid font-normal">DH</span></td>
                                                <td className="px-4 py-3 text-right text-[13px] font-semibold text-ant-green tabular-nums">{tx.paid_price || 0} <span className="text-ant-mid font-normal">DH</span></td>
                                                <td className={cn('px-4 py-3 text-right text-[13px] font-semibold tabular-nums', balance > 0 ? 'text-ant-rose' : 'text-ant-mid')}>
                                                    {balance} <span className="text-ant-mid font-normal">DH</span>
                                                </td>
                                                <td className="px-4 py-3">{getStatusBadge(tx)}</td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button type="button" variant="ghost" size="icon" title="View" onClick={() => { setSelectedTransaction(tx); setIsViewModalOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-ink/5 cursor-pointer">
                                                            <Eye className="h-3.5 w-3.5 text-ant-mid" />
                                                        </Button>
                                                        <Button type="button" variant="ghost" size="icon" title="Edit" onClick={() => { setEditingTransactionId(tx.id); transactionForm.reset(mapTransactionToFormValues(tx)); setTransactionModalOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-orange/10 cursor-pointer">
                                                            <Pencil className="h-3.5 w-3.5 text-ant-orange" />
                                                        </Button>
                                                        <Button type="button" variant="ghost" size="icon" title="Record payment" onClick={() => { setSelectedTransaction(tx); paymentForm.setValue('amount', balance); setIsPaymentModalOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-green/10 cursor-pointer">
                                                            <Wallet className="h-3.5 w-3.5 text-ant-green" />
                                                        </Button>
                                                        <Button type="button" variant="ghost" size="icon" title="Delete" onClick={() => { setSelectedTransaction(tx); setIsDeleteDialogOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-rose/10 cursor-pointer">
                                                            <Trash2 className="h-3.5 w-3.5 text-ant-rose" />
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {displayTransactions.map((tx) => {
                            const balance = (tx.total_price || 0) - (tx.paid_price || 0);
                            const status = getPaymentStatus(tx);
                            const stripeColor = status === 'paid' ? 'bg-ant-green' : status === 'partial' ? 'bg-ant-orange' : 'bg-ant-rose';
                            return (
                                <div key={tx.id} className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper flex flex-col">
                                    <div className={cn('h-[3px] w-full', stripeColor)} />
                                    <div className="p-4 flex flex-col gap-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0 space-y-0.5">
                                                <p className="text-[13px] font-semibold text-ant-ink truncate">{tx.name}</p>
                                                <p className="text-[11px] text-ant-mid tabular-nums inline-flex items-center gap-1.5">
                                                    <Calendar className="w-3 h-3" />
                                                    {format(new Date(tx.date || tx.created_at), 'MMM dd, yyyy')}
                                                </p>
                                            </div>
                                            {getStatusBadge(tx)}
                                        </div>

                                        <div className="grid grid-cols-2 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                                            <div className="bg-ant-paper p-2.5">
                                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Invoiced</p>
                                                <p className="font-display text-[18px] font-semibold text-ant-ink tabular-nums mt-0.5">
                                                    {tx.total_price || 0}
                                                    <span className="text-[11px] text-ant-mid font-normal ml-1">DH</span>
                                                </p>
                                            </div>
                                            <div className="bg-ant-paper p-2.5">
                                                <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Outstanding</p>
                                                <p className={cn('font-display text-[18px] font-semibold tabular-nums mt-0.5', balance > 0 ? 'text-ant-rose' : 'text-ant-green')}>
                                                    {balance}
                                                    <span className="text-[11px] text-ant-mid font-normal ml-1">DH</span>
                                                </p>
                                            </div>
                                        </div>

                                        <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                                            <p className="text-[11px] text-ant-mid">
                                                <span className="tabular-nums">{tx.items?.length || 0}</span> items · <span className="tabular-nums">{tx.payments?.length || 0}</span> payments
                                            </p>
                                            <div className="flex items-center gap-0.5">
                                                <Button type="button" variant="ghost" size="icon" title="View" onClick={() => { setSelectedTransaction(tx); setIsViewModalOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-ink/5 cursor-pointer">
                                                    <Eye className="h-3.5 w-3.5 text-ant-mid" />
                                                </Button>
                                                <Button type="button" variant="ghost" size="icon" title="Edit" onClick={() => { setEditingTransactionId(tx.id); transactionForm.reset(mapTransactionToFormValues(tx)); setTransactionModalOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-orange/10 cursor-pointer">
                                                    <Pencil className="h-3.5 w-3.5 text-ant-orange" />
                                                </Button>
                                                <Button type="button" variant="ghost" size="icon" title="Pay" onClick={() => { setSelectedTransaction(tx); paymentForm.setValue('amount', balance); setIsPaymentModalOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-green/10 cursor-pointer">
                                                    <Wallet className="h-3.5 w-3.5 text-ant-green" />
                                                </Button>
                                                <Button type="button" variant="ghost" size="icon" title="Delete" onClick={() => { setSelectedTransaction(tx); setIsDeleteDialogOpen(true); }} className="h-8 w-8 p-0 rounded-full hover:bg-ant-rose/10 cursor-pointer">
                                                    <Trash2 className="h-3.5 w-3.5 text-ant-rose" />
                                                </Button>
                                            </div>
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
                <DialogContent className="max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col max-h-[90vh]">
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
                            <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-ant-line space-y-1.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    {editingTransactionId ? 'Edit · Ledger' : 'New · Ledger'}
                                </div>
                                <DialogTitle className="font-display text-[22px] leading-tight tracking-tight text-ant-ink">
                                    {editingTransactionId ? 'Edit supplier transaction' : 'Record a new purchase'}
                                </DialogTitle>
                                <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                    {editingTransactionId
                                        ? 'Adjust supplier details and line items — past payments stay untouched.'
                                        : 'Capture the invoice, update stock, and start the payment clock in one pass.'}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="ant-scroll overflow-y-auto p-6 space-y-6 flex-1 min-h-0">
                                <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">01</span>
                                            Supplier profile
                                        </div>
                                        <div className="grid grid-cols-1 gap-3">
                                            <FormField
                                                control={transactionForm.control}
                                                name="name"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Supplier name</FormLabel>
                                                        <FormControl>
                                                            <div className="relative">
                                                                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" />
                                                                <Input placeholder="E.g. Global Supplies Ltd" {...field} className="pl-9 h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40" />
                                                            </div>
                                                        </FormControl>
                                                        <FormMessage className="text-ant-rose" />
                                                    </FormItem>
                                                )}
                                            />
                                            <div className="grid grid-cols-2 gap-3">
                                                <FormField
                                                    control={transactionForm.control}
                                                    name="phone"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-1.5">
                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Phone</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="+212..." {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid" />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                <FormField
                                                    control={transactionForm.control}
                                                    name="date"
                                                    render={({ field }) => (
                                                        <FormItem className="space-y-1.5">
                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Invoice date</FormLabel>
                                                            <FormControl>
                                                                <Input type="date" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink" />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">02</span>
                                            Context &amp; notes
                                        </div>
                                        <div className="grid grid-cols-1 gap-3">
                                            <FormField
                                                control={transactionForm.control}
                                                name="address"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Supplier address</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Warehouse location..." {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={transactionForm.control}
                                                name="note"
                                                render={({ field }) => (
                                                    <FormItem className="space-y-1.5">
                                                        <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Internal notes</FormLabel>
                                                        <FormControl>
                                                            <Input placeholder="Extra details about this order..." {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid" />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    </div>
                                </section>

                                <section className="space-y-3">
                                    <div className="flex items-center justify-between border-b border-ant-line pb-3">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="font-display text-ant-orange font-semibold">03</span>
                                            Invoice items
                                        </div>
                                        <div className="flex gap-1.5">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => append({ type: 'product' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 })}
                                                className="h-8 px-3 rounded-full text-[11px] font-semibold text-ant-ink border border-ant-line hover:bg-ant-light gap-1.5 cursor-pointer"
                                            >
                                                <Package className="w-3.5 h-3.5" /> Product
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => append({ type: 'accessory' as const, product_id: '', accessory_id: '', quantity: 1, unit_price: 0 })}
                                                className="h-8 px-3 rounded-full text-[11px] font-semibold text-ant-orange border border-ant-orange/30 hover:bg-ant-orange/10 gap-1.5 cursor-pointer"
                                            >
                                                <Puzzle className="w-3.5 h-3.5" /> Accessory
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
                                                    'relative overflow-hidden rounded-2xl border bg-ant-paper',
                                                    isProduct ? 'border-ant-line' : 'border-ant-orange/25'
                                                )}>
                                                    <div className={cn('h-[3px] w-full', isProduct ? 'bg-ant-ink/20' : 'bg-ant-orange')} />
                                                    <div className="p-3">
                                                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                                                            <div className="md:col-span-5">
                                                                {isProduct ? (
                                                                    <FormField
                                                                        control={transactionForm.control}
                                                                        name={`items.${index}.product_id`}
                                                                        render={({ field }) => {
                                                                            const selectedProduct = products?.find(p => p.id === field.value);
                                                                            return (
                                                                                <FormItem className="space-y-1.5">
                                                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid flex items-center gap-1.5"><Package className="w-3 h-3" /> Product</FormLabel>
                                                                                    <Popover modal={true}>
                                                                                        <PopoverTrigger asChild>
                                                                                            <FormControl>
                                                                                                <Button
                                                                                                    variant="outline"
                                                                                                    role="combobox"
                                                                                                    className={cn(
                                                                                                        'h-10 w-full justify-between rounded-xl border-ant-line bg-ant-paper text-[12px] font-semibold text-ant-ink',
                                                                                                        !field.value && 'text-ant-mid font-normal'
                                                                                                    )}
                                                                                                >
                                                                                                    <span className="truncate">
                                                                                                        {selectedProduct ? selectedProduct.name : 'Select product'}
                                                                                                    </span>
                                                                                                    <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                                                </Button>
                                                                                            </FormControl>
                                                                                        </PopoverTrigger>
                                                                                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="start">
                                                                                            <Command>
                                                                                                <CommandInput placeholder="Search products..." className="h-9 text-[12px]" />
                                                                                                <CommandList className="max-h-[200px] overflow-y-auto">
                                                                                                    <CommandEmpty className="text-[12px] text-ant-mid py-4 text-center">No product found.</CommandEmpty>
                                                                                                    <CommandGroup>
                                                                                                        {products?.map(p => (
                                                                                                            <CommandItem
                                                                                                                key={p.id}
                                                                                                                value={`${p.name} ${p.code}`}
                                                                                                                onSelect={() => field.onChange(p.id)}
                                                                                                                className="text-[12px] cursor-pointer rounded-lg"
                                                                                                            >
                                                                                                                <Check className={cn('mr-2 h-3 w-3', field.value === p.id ? 'opacity-100 text-ant-orange' : 'opacity-0')} />
                                                                                                                {p.name}
                                                                                                                <span className="text-ant-mid ml-2 text-[10px] tabular-nums">({p.code})</span>
                                                                                                            </CommandItem>
                                                                                                        ))}
                                                                                                    </CommandGroup>
                                                                                                </CommandList>
                                                                                            </Command>
                                                                                        </PopoverContent>
                                                                                    </Popover>
                                                                                    <FormMessage className="text-ant-rose" />
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
                                                                                <FormItem className="space-y-1.5">
                                                                                    <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-orange flex items-center gap-1.5"><Puzzle className="w-3 h-3" /> Accessory</FormLabel>
                                                                                    <Popover modal={true}>
                                                                                        <PopoverTrigger asChild>
                                                                                            <FormControl>
                                                                                                <Button
                                                                                                    variant="outline"
                                                                                                    role="combobox"
                                                                                                    className={cn(
                                                                                                        'h-10 w-full justify-between rounded-xl border-ant-line bg-ant-paper text-[12px] font-semibold text-ant-ink',
                                                                                                        !field.value && 'text-ant-mid font-normal'
                                                                                                    )}
                                                                                                >
                                                                                                    <span className="truncate">
                                                                                                        {selectedAccessory ? selectedAccessory.name : 'Select accessory'}
                                                                                                    </span>
                                                                                                    <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                                                                                                </Button>
                                                                                            </FormControl>
                                                                                        </PopoverTrigger>
                                                                                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="start">
                                                                                            <Command>
                                                                                                <CommandInput placeholder="Search accessories..." className="h-9 text-[12px]" />
                                                                                                <CommandList className="max-h-[200px] overflow-y-auto">
                                                                                                    <CommandEmpty className="text-[12px] text-ant-mid py-4 text-center">No accessory found.</CommandEmpty>
                                                                                                    <CommandGroup>
                                                                                                        {accessories?.map(a => (
                                                                                                            <CommandItem
                                                                                                                key={a.id}
                                                                                                                value={`${a.name} ${a.code}`}
                                                                                                                onSelect={() => field.onChange(a.id)}
                                                                                                                className="text-[12px] cursor-pointer rounded-lg"
                                                                                                            >
                                                                                                                <Check className={cn('mr-2 h-3 w-3', field.value === a.id ? 'opacity-100 text-ant-orange' : 'opacity-0')} />
                                                                                                                {a.name}
                                                                                                                <span className="text-ant-mid ml-2 text-[10px] tabular-nums">({a.code})</span>
                                                                                                            </CommandItem>
                                                                                                        ))}
                                                                                                    </CommandGroup>
                                                                                                </CommandList>
                                                                                            </Command>
                                                                                        </PopoverContent>
                                                                                    </Popover>
                                                                                    <FormMessage className="text-ant-rose" />
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
                                                                        <FormItem className="space-y-1.5">
                                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Qty</FormLabel>
                                                                            <Input type="number" placeholder="0" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink tabular-nums" />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            </div>
                                                            <div className="md:col-span-3">
                                                                <FormField
                                                                    control={transactionForm.control}
                                                                    name={`items.${index}.unit_price`}
                                                                    render={({ field }) => (
                                                                        <FormItem className="space-y-1.5">
                                                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Unit cost · DH</FormLabel>
                                                                            <div className="relative">
                                                                                <Input type="number" step="0.01" placeholder="0" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink tabular-nums pr-20" />
                                                                                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-ant-mid tabular-nums">{lineSubtotal.toFixed(2)}</div>
                                                                            </div>
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            </div>
                                                            <div className="md:col-span-2 flex items-end justify-end">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => remove(index)}
                                                                    disabled={fields.length === 1}
                                                                    className="h-10 w-10 rounded-full text-ant-rose hover:text-ant-rose hover:bg-ant-rose/10 cursor-pointer"
                                                                    title="Remove line"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="rounded-2xl border border-ant-line bg-ant-ink text-white px-5 py-4 flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-white/50">Grand total</p>
                                            <p className="font-display text-[26px] font-semibold tabular-nums text-white">
                                                {transactionForm.watch('items').reduce((acc, item) => acc + (item.quantity * item.unit_price), 0).toFixed(2)} <span className="text-[13px] font-normal text-white/60">DH</span>
                                            </p>
                                        </div>
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-orange/40 bg-ant-orange/15 text-ant-orange px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
                                            <Sparkles className="w-3 h-3" />
                                            {editingTransactionId ? 'Edit invoice' : 'Invoice draft'}
                                        </span>
                                    </div>
                                </section>
                            </div>

                            <DialogFooter className="px-6 py-4 shrink-0 border-t border-ant-line gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setTransactionModalOpen(false);
                                        setEditingTransactionId(null);
                                        transactionForm.reset(defaultTransactionFormValues);
                                    }}
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                >
                                    Discard
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={createTransactionMutation.isPending || updateTransactionMutation.isPending}
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                >
                                    {(createTransactionMutation.isPending || updateTransactionMutation.isPending) && (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    )}
                                    {editingTransactionId ? 'Save changes' : 'Finalize & update stock'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Add Payment Modal */}
            <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
                <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col">
                    <Form {...paymentForm}>
                        <form onSubmit={paymentForm.handleSubmit(v => addPaymentMutation.mutate(v))} className="flex flex-col h-full">
                            <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-green" />
                                    Payment · Tranche
                                </div>
                                <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Record a payment</DialogTitle>
                                <DialogDescription className="font-serif italic text-[13px] text-ant-mid">Chip away at what {selectedTransaction?.name || 'this supplier'} is owed.</DialogDescription>
                            </DialogHeader>

                            <div className="p-6 space-y-4">
                                <div className="rounded-2xl border border-ant-rose/25 bg-ant-rose/5 px-4 py-3 flex items-center justify-between">
                                    <div>
                                        <p className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Remaining balance</p>
                                        <p className="font-display text-[24px] font-semibold tabular-nums text-ant-ink mt-0.5">
                                            {(selectedTransaction?.total_price || 0) - (selectedTransaction?.paid_price || 0)}
                                            <span className="text-[13px] text-ant-mid font-normal ml-1">DH</span>
                                        </p>
                                    </div>
                                    <Wallet className="w-6 h-6 text-ant-rose" strokeWidth={1.75} />
                                </div>

                                <FormField
                                    control={paymentForm.control}
                                    name="amount"
                                    render={({ field }) => (
                                        <FormItem className="space-y-1.5">
                                            <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Amount to pay · DH</FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink tabular-nums focus-visible:ring-1 focus-visible:ring-ant-orange/40" />
                                            </FormControl>
                                            <FormMessage className="text-ant-rose" />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={paymentForm.control}
                                        name="method"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Method</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-xl border-ant-line">
                                                        <SelectItem value="Cash" className="text-[12px]">Cash</SelectItem>
                                                        <SelectItem value="Bank Transfer" className="text-[12px]">Bank transfer</SelectItem>
                                                        <SelectItem value="Check" className="text-[12px]">Check</SelectItem>
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
                                                <FormLabel className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">Date</FormLabel>
                                                <FormControl>
                                                    <Input type="date" {...field} className="h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsPaymentModalOpen(false)}
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={addPaymentMutation.isPending}
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                >
                                    {addPaymentMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    Confirm payment
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* View Modal */}
            <Dialog open={isViewModalOpen} onOpenChange={setIsViewModalOpen}>
                <DialogContent className="max-w-4xl p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col max-h-[90vh]">
                    {selectedTransaction && (
                        <>
                            <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 space-y-1.5">
                                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                            Ledger entry
                                        </div>
                                        <DialogTitle className="font-display text-[24px] leading-tight tracking-tight text-ant-ink truncate">{selectedTransaction.name}</DialogTitle>
                                        <div className="flex flex-wrap items-center gap-4 text-[12px] text-ant-mid">
                                            <span className="inline-flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> {format(new Date(selectedTransaction.date), 'MMM dd, yyyy')}</span>
                                            {selectedTransaction.phone && <span className="inline-flex items-center gap-1.5 tabular-nums"><Phone className="w-3.5 h-3.5" /> {selectedTransaction.phone}</span>}
                                        </div>
                                    </div>
                                    {getStatusBadge(selectedTransaction)}
                                </div>
                            </DialogHeader>

                            <div className="ant-scroll overflow-y-auto p-6 space-y-6 flex-1 min-h-0">
                                {/* Ink summary panel */}
                                <section className="rounded-2xl border border-ant-ink bg-ant-ink text-white overflow-hidden">
                                    <div className="grid grid-cols-3 divide-x divide-white/10">
                                        {[
                                            { label: 'Invoiced', value: selectedTransaction.total_price || 0, tone: 'text-white', dot: 'bg-ant-orange' },
                                            { label: 'Paid', value: selectedTransaction.paid_price || 0, tone: 'text-ant-green', dot: 'bg-ant-green' },
                                            { label: 'Outstanding', value: (selectedTransaction.total_price || 0) - (selectedTransaction.paid_price || 0), tone: 'text-ant-rose', dot: 'bg-ant-rose' },
                                        ].map((s) => (
                                            <div key={s.label} className="px-5 py-4">
                                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/50">
                                                    <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
                                                    {s.label}
                                                </div>
                                                <p className={cn('font-display text-[24px] font-semibold tabular-nums mt-1', s.tone)}>
                                                    {s.value}
                                                    <span className="text-[12px] text-white/50 font-normal ml-1">DH</span>
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                                    {/* Items */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <Package className="w-3 h-3" />
                                                Line items
                                            </div>
                                            <span className="rounded-full border border-ant-line px-2 py-0.5 text-[10px] font-semibold text-ant-mid tabular-nums">{selectedTransaction.items?.length || 0}</span>
                                        </div>
                                        <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                            {selectedTransaction.items?.map((item: any) => (
                                                <div key={item.id} className="px-4 py-3 border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors">
                                                    {item.product && (
                                                        <div className="flex justify-between items-center">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className="h-8 w-8 rounded-lg bg-ant-ink/5 border border-ant-line flex items-center justify-center shrink-0">
                                                                    <Package className="w-3.5 h-3.5 text-ant-ink" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-[12px] font-semibold text-ant-ink truncate">{item.product.name}</p>
                                                                    <p className="text-[10px] text-ant-mid tabular-nums">{item.product.code}</p>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 ml-3">
                                                                <p className="text-[12px] font-semibold text-ant-ink tabular-nums">× {item.quantity}</p>
                                                                <p className="text-[11px] text-ant-orange tabular-nums font-semibold">{item.sub_total} DH</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {item.accessory && (
                                                        <div className={cn('flex justify-between items-center', item.product && 'border-t border-ant-line mt-3 pt-3')}>
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <div className="h-8 w-8 rounded-lg bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center shrink-0">
                                                                    <Puzzle className="w-3.5 h-3.5 text-ant-orange" />
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <p className="text-[12px] font-semibold text-ant-ink truncate">{item.accessory.name}</p>
                                                                    <p className="text-[10px] text-ant-mid tabular-nums">{item.accessory.code}</p>
                                                                </div>
                                                            </div>
                                                            <div className="text-right shrink-0 ml-3">
                                                                <p className="text-[12px] font-semibold text-ant-ink tabular-nums">× {item.accessory_quantity}</p>
                                                                <p className="text-[11px] text-ant-orange tabular-nums font-semibold">{item.accessory_sub_total} DH</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Payment log */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                                <Wallet className="w-3 h-3" />
                                                Payment log
                                            </div>
                                            <span className="rounded-full border border-ant-line px-2 py-0.5 text-[10px] font-semibold text-ant-mid tabular-nums">{selectedTransaction.payments?.length || 0}</span>
                                        </div>
                                        {selectedTransaction.payments?.length === 0 ? (
                                            <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper py-10 text-center">
                                                <Wallet className="w-6 h-6 text-ant-mid mx-auto mb-2" strokeWidth={1.5} />
                                                <p className="font-serif italic text-[12px] text-ant-mid">No payments recorded yet.</p>
                                            </div>
                                        ) : (
                                            <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                                {selectedTransaction.payments?.map((payment: any) => (
                                                    <div key={payment.id} className="group px-4 py-3 border-b border-ant-line last:border-0 flex justify-between items-center hover:bg-ant-light/60 transition-colors">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="h-8 w-8 rounded-lg bg-ant-green/10 border border-ant-green/25 flex items-center justify-center">
                                                                <Wallet className="w-3.5 h-3.5 text-ant-green" />
                                                            </div>
                                                            <div>
                                                                <p className="text-[12px] font-semibold text-ant-ink">{payment.method}</p>
                                                                <p className="text-[10px] text-ant-mid tabular-nums">{format(new Date(payment.date), 'MMM dd · HH:mm')}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <p className="text-[13px] font-semibold text-ant-green tabular-nums">+{payment.amount} <span className="text-ant-mid font-normal text-[11px]">DH</span></p>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                title="Remove payment"
                                                                onClick={() => setPaymentToDelete(payment)}
                                                                className="h-7 w-7 p-0 rounded-full text-ant-mid hover:text-ant-rose hover:bg-ant-rose/10 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {selectedTransaction.note && (
                                    <div className="rounded-2xl border border-ant-line bg-ant-light/40 px-5 py-4">
                                        <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid mb-2">Note</p>
                                        <p className="font-serif italic text-[13px] text-ant-ink/80 leading-relaxed">&ldquo;{selectedTransaction.note}&rdquo;</p>
                                    </div>
                                )}
                            </div>

                            <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2 flex-row justify-end">
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
                                    className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-[12px] font-semibold text-ant-ink hover:bg-ant-light gap-2 cursor-pointer"
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
                                    className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                >
                                    <Wallet className="h-3.5 w-3.5" />
                                    Record payment
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete payment confirmation */}
            <Dialog open={!!paymentToDelete} onOpenChange={(open) => !open && setPaymentToDelete(null)}>
                <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                            Destructive action
                        </div>
                        <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Remove this payment?</DialogTitle>
                        <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                            {paymentToDelete && (
                                <>The {paymentToDelete.method} entry of {paymentToDelete.amount} DH from {format(new Date(paymentToDelete.date), 'MMM dd · yyyy')} will be erased from the ledger.</>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="px-6 py-4 gap-2">
                        <Button
                            variant="ghost"
                            onClick={() => setPaymentToDelete(null)}
                            className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={() => {
                                if (paymentToDelete) {
                                    deletePaymentMutation.mutate(paymentToDelete.id);
                                }
                            }}
                            disabled={deletePaymentMutation.isPending}
                            className="h-10 px-5 rounded-full bg-ant-rose hover:bg-ant-rose/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            {deletePaymentMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Yes, remove
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
            <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden flex flex-col">
                    <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                            Destructive action
                        </div>
                        <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this transaction?</DialogTitle>
                        <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                            This removes the record permanently. Line items and payments tied to it will be deleted in the same motion.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="px-6 py-4 gap-2">
                        <Button
                            variant="ghost"
                            onClick={() => setIsDeleteDialogOpen(false)}
                            className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
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
                            className="h-10 px-5 rounded-full bg-ant-rose hover:bg-ant-rose/90 text-white text-[12px] font-semibold gap-2 cursor-pointer"
                        >
                            {deleteTransactionMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Yes, delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            </div>
        </div>
    );
};

export default Transactions;
