import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    History,
    MoreVertical,
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
    Eye
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
        product_id: z.string().uuid("Please select a product"),
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

const Transactions = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isViewModalOpen, setIsViewModalOpen] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // --- Queries ---
    const { data: transactions, isLoading } = useQuery({
        queryKey: ['transactions'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('transactions')
                .select(`
                    *,
                    items:trns_purchase(*, product:products(name, code)),
                    payments:trns_payment(*)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const { data: products } = useQuery({
        queryKey: ['products-minimal'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('products')
                .select('id, name, code, cost_price')
                .eq('active', true);
            if (error) throw error;
            return data;
        },
    });

    // --- Forms ---
    const transactionForm = useForm<TransactionFormValues>({
        resolver: zodResolver(transactionSchema),
        defaultValues: {
            name: '',
            phone: '',
            email: '',
            address: '',
            note: '',
            date: new Date().toISOString().split('T')[0],
            items: [{ product_id: '', quantity: 1, unit_price: 0 }]
        }
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
                })
                .select()
                .single();

            if (txError) throw txError;

            // 2. Create purchase items
            const items = values.items.map(item => ({
                transaction_id: tx.id,
                product_id: item.product_id,
                quantity: item.quantity,
                sub_total: item.quantity * item.unit_price
            }));

            const { error: itemsError } = await supabase
                .from('trns_purchase')
                .insert(items);

            if (itemsError) throw itemsError;

            return tx;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            queryClient.invalidateQueries({ queryKey: ['products'] }); // Stock changed
            setIsAddModalOpen(false);
            transactionForm.reset();
            toast({ title: "Transaction Created", description: "Purchases and stock updated successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const addPaymentMutation = useMutation({
        mutationFn: async (values: PaymentFormValues) => {
            const { data, error } = await supabase
                .from('trns_payment')
                .insert({
                    transaction_id: selectedTransaction.id,
                    amount: values.amount,
                    method: values.method,
                    date: values.date
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions'] });
            setIsPaymentModalOpen(false);
            paymentForm.reset();
            toast({ title: "Payment Added", description: "Ledger updated successfully." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // --- Helpers ---
    const filteredTransactions = transactions?.filter(tx =>
        tx.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        tx.phone?.includes(searchQuery)
    );

    const getStatusBadge = (tx: any) => {
        const balance = (tx.total_price || 0) - (tx.paid_price || 0);
        if (balance <= 0 && tx.total_price > 0) return <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold">PAID</Badge>;
        if (tx.paid_price > 0) return <Badge className="bg-amber-50 text-amber-600 border-none font-bold">PARTIAL</Badge>;
        return <Badge className="bg-red-50 text-red-600 border-none font-bold">UNPAID</Badge>;
    };

    return (
        <div className="min-h-screen bg-brand-navy/[0.02] p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                    <h1 className="text-4xl font-bold tracking-tight text-brand-navy">Supplier Transactions</h1>
                    <p className="text-muted-foreground text-lg">Manage your inventory purchases and payments ledger.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    <div className="relative group sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Search supplier or phone..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-brand-white border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                    <Button
                        onClick={() => setIsAddModalOpen(true)}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <PlusCircle className="w-5 h-5" />
                        New Purchase
                    </Button>
                </div>
            </div>

            {/* Content Section */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-64 w-full rounded-[32px]" />
                    ))}
                </div>
            ) : filteredTransactions?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-brand-white rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <History className="w-12 h-12 text-brand-navy/20" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-brand-navy">No transactions found</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto">Start logging your supplier purchases to track stock and payments.</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredTransactions?.map((tx) => (
                        <Card
                            key={tx.id}
                            className="group relative overflow-hidden border-none bg-brand-white shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px]"
                        >
                            <CardContent className="p-8 space-y-6">
                                <div className="flex justify-between items-start">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <div className="w-10 h-10 rounded-xl bg-brand-navy/[0.04] flex items-center justify-center text-brand-navy">
                                                <User className="w-5 h-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold text-brand-navy truncate">{tx.name}</h3>
                                                <div className="flex items-center gap-1.5 text-muted-foreground">
                                                    <Calendar className="w-3 h-3" />
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
                                        <p className={cn(
                                            "text-2xl font-bold",
                                            (tx.total_price - tx.paid_price) > 0 ? "text-red-500" : "text-emerald-500"
                                        )}>
                                            {(tx.total_price || 0) - (tx.paid_price || 0)} DH
                                        </p>
                                    </div>
                                </div>

                                <Separator className="bg-brand-navy/[0.05]" />

                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Items</span>
                                            <span className="text-sm font-bold text-brand-navy">{tx.items?.length || 0} kinds</span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">Payments</span>
                                            <span className="text-sm font-bold text-brand-navy">{tx.payments?.length || 0} tranches</span>
                                        </div>
                                    </div>

                                    <div className="flex gap-2">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => {
                                                setSelectedTransaction(tx);
                                                setIsViewModalOpen(true);
                                            }}
                                            className="h-10 w-10 rounded-xl bg-brand-navy/[0.04] hover:bg-brand-navy text-brand-navy hover:text-brand-white transition-all"
                                        >
                                            <Eye className="w-5 h-5" />
                                        </Button>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl bg-brand-navy/[0.04] text-brand-navy hover:bg-brand-navy/[0.08]">
                                                    <MoreVertical className="h-5 w-5" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[180px]">
                                                <DropdownMenuItem
                                                    onClick={() => {
                                                        setSelectedTransaction(tx);
                                                        paymentForm.setValue('amount', (tx.total_price || 0) - (tx.paid_price || 0));
                                                        setIsPaymentModalOpen(true);
                                                    }}
                                                    className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3"
                                                >
                                                    <Wallet className="w-4 h-4" />
                                                    <span className="font-bold">Record Payment</span>
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                                    <Trash2 className="w-4 h-4" />
                                                    <span className="font-bold">Delete Record</span>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Add Transaction Modal */}
            <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
                <DialogContent className="max-w-4xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                    <Form {...transactionForm}>
                        <form onSubmit={transactionForm.handleSubmit(v => createTransactionMutation.mutate(v))} className="flex flex-col h-full">
                            <DialogHeader className="p-8 pb-4">
                                <DialogTitle className="text-3xl font-bold text-brand-navy">New Purchase Transaction</DialogTitle>
                                <DialogDescription className="text-muted-foreground text-lg">Log supplier invoices and update inventory stock instantly.</DialogDescription>
                            </DialogHeader>

                            <div className="overflow-y-auto p-8 pt-4 space-y-8 flex-1">
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
                                                                <Input placeholder="E.g. Global Supplies Ltd" {...field} className="pl-11 h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
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
                                                                <Input placeholder="+212..." {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
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
                                                            <Input placeholder="Warehouse location..." {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
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
                                                            <Input placeholder="Extra details about this order..." {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
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
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            onClick={() => append({ product_id: '', quantity: 1, unit_price: 0 })}
                                            className="text-xs font-bold text-brand-navy hover:bg-brand-navy/[0.05] gap-2 rounded-xl"
                                        >
                                            <Plus className="w-3.5 h-3.5" /> Add Row
                                        </Button>
                                    </div>

                                    <div className="space-y-4">
                                        {fields.map((field, index) => (
                                            <div key={field.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end animate-in slide-in-from-left-2 duration-300">
                                                <div className="md:col-span-6">
                                                    <FormField
                                                        control={transactionForm.control}
                                                        name={`items.${index}.product_id`}
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1">
                                                                <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground/60">Product</FormLabel>
                                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                                    <FormControl>
                                                                        <SelectTrigger className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner">
                                                                            <SelectValue placeholder="Select a product" />
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
                                                </div>
                                                <div className="md:col-span-2">
                                                    <FormField
                                                        control={transactionForm.control}
                                                        name={`items.${index}.quantity`}
                                                        render={({ field }) => (
                                                            <FormItem className="space-y-1">
                                                                <FormLabel className="text-[10px] uppercase font-bold text-muted-foreground/60">Qty</FormLabel>
                                                                <Input type="number" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
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
                                                                    <Input type="number" step="0.01" {...field} className="h-12 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-brand-navy/30">
                                                                        {(transactionForm.watch(`items.${index}.quantity`) * transactionForm.watch(`items.${index}.unit_price`)).toFixed(1)} DH
                                                                    </div>
                                                                </div>
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                                <div className="md:col-span-1">
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
                                        ))}
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
                                        <Badge className="bg-emerald-50 text-emerald-600 border-none font-bold px-4 py-2 rounded-xl">Invoice Draft</Badge>
                                    </div>
                                </div>
                            </div>

                            <DialogFooter className="p-8 pt-0 shrink-0 bg-brand-white">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsAddModalOpen(false)}
                                    className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-muted"
                                >
                                    Discard
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={createTransactionMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center gap-3"
                                >
                                    {createTransactionMutation.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                                    Finalize & Update Stock
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

                            <div className="overflow-y-auto p-10 space-y-10 flex-1">
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
                                            <Badge variant="outline" className="text-[10px] font-black border-brand-navy/10">{selectedTransaction.items?.length || 0} products</Badge>
                                        </div>
                                        <div className="space-y-4">
                                            {selectedTransaction.items?.map((item: any) => (
                                                <div key={item.id} className="p-6 rounded-[24px] bg-brand-navy/[0.02] border border-brand-navy/[0.03] flex justify-between items-center group hover:bg-brand-navy/[0.04] transition-colors">
                                                    <div>
                                                        <h5 className="font-bold text-brand-navy">{item.product?.name}</h5>
                                                        <p className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest">{item.product?.code}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm font-black text-brand-navy">{item.quantity} units</p>
                                                        <p className="text-[10px] font-bold text-emerald-600 uppercase">+{item.sub_total} DH</p>
                                                    </div>
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

                            <DialogFooter className="p-10 pt-0 shrink-0">
                                <Button
                                    onClick={() => {
                                        setIsViewModalOpen(false);
                                        paymentForm.setValue('amount', (selectedTransaction.total_price || 0) - (selectedTransaction.paid_price || 0));
                                        setIsPaymentModalOpen(true);
                                    }}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/30 transition-all active:scale-95 flex items-center gap-3 w-full"
                                >
                                    <Wallet className="w-5 h-5" />
                                    Make a Payment for this Order
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Transactions;
