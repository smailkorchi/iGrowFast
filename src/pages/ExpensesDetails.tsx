import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    X,
    Calendar,
    DollarSign,
    Tag,
    FileText,
    ChevronRight,
    Filter,
    ArrowDownWideNarrow,
    History,
    Receipt
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

// --- Schema ---
const expenseSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    type_id: z.string().uuid("Please select a category"),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    date: z.date().default(() => new Date()),
    description: z.string().optional(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

const ExpensesDetails = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<any>(null);
    const [expenseToDelete, setExpenseToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedType, setSelectedType] = useState<string>("all");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: expenses, isLoading: isExpensesLoading } = useQuery({
        queryKey: ['expenses', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('expenses' as any)
                .select('*, expense_types(name)')
                .eq('DigiCom Business', activeBusinessId)
                .order('date', { ascending: false }) as any);

            if (error) throw error;
            return data;
        },
    });

    const { data: expenseTypes } = useQuery({
        queryKey: ['expense_types', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('expense_types' as any)
                .select('*')
                .eq('active', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('name', { ascending: true }) as any);

            if (error) throw error;
            return data;
        },
    });

    // --- Form Setup ---
    const form = useForm<ExpenseFormValues>({
        resolver: zodResolver(expenseSchema),
        defaultValues: {
            name: '',
            type_id: '',
            amount: 0,
            date: new Date(),
            description: '',
        }
    });

    // --- Mutations ---
    const upsertMutation = useMutation({
        mutationFn: async (values: ExpenseFormValues) => {
            const payload = {
                ...values,
                date: values.date.toISOString(),
            };

            if (editingExpense) {
                const { data, error } = await (supabase
                    .from('expenses' as any)
                    .update({ ...payload, 'DigiCom Business': activeBusinessId })
                    .eq('id', editingExpense.id)
                    .eq('DigiCom Business', activeBusinessId) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await (supabase
                    .from('expenses' as any)
                    .insert({
                        ...payload,
                        'DigiCom Business': activeBusinessId
                    }) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['expenses', activeBusinessId] });
            setIsUpsertOpen(false);
            setEditingExpense(null);
            toast({
                title: editingExpense ? "Expense updated" : "Expense recorded",
                description: `Successfully ${editingExpense ? 'updated' : 'added'} ${data.name} (${data.amount} DH).`
            });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase
                .from('expenses' as any)
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId) as any);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['expenses', activeBusinessId] });
            setExpenseToDelete(null);
            toast({ title: "Expense deleted", description: "The record has been permanently removed." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const handleUpsert = (values: ExpenseFormValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (expense: any = null) => {
        if (expense) {
            setEditingExpense(expense);
            form.reset({
                name: expense.name,
                type_id: expense.type_id,
                amount: expense.amount,
                date: new Date(expense.date),
                description: expense.description || '',
            });
        } else {
            setEditingExpense(null);
            form.reset({
                name: '',
                type_id: '',
                amount: 0,
                date: new Date(),
                description: '',
            });
        }
        setIsUpsertOpen(true);
    };

    const filteredExpenses = expenses?.filter((e: any) => {
        const matchesSearch = e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            e.description?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesType = selectedType === "all" || e.type_id === selectedType;
        return matchesSearch && matchesType;
    });

    const totalAmount = filteredExpenses?.reduce((acc: number, curr: any) => acc + Number(curr.amount), 0) || 0;

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="space-y-4">
                    <div className="space-y-2">
                        <h1 className="text-4xl font-black tracking-tight text-brand-navy uppercase flex items-center gap-3">
                            <History className="w-10 h-10 text-brand-navy" />
                            Expense Tracker
                        </h1>
                        <p className="text-brand-navy/60 text-lg font-medium">Keep track of every cent your business spends.</p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        <div className="bg-brand-navy p-6 rounded-[32px] shadow-2xl shadow-brand-navy/20 group hover:scale-[1.02] transition-transform duration-500">
                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-white/40 mb-1">Total Period Budget</p>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl font-black text-brand-white">{totalAmount.toLocaleString()}</span>
                                <span className="text-sm font-bold text-brand-white/60">DH</span>
                            </div>
                        </div>
                        <div className="bg-brand-blue p-6 rounded-[32px] shadow-2xl shadow-brand-blue/20 group hover:scale-[1.02] transition-transform duration-500">
                            <p className="text-[10px] font-black uppercase tracking-widest text-brand-white/40 mb-1">Total Transactions</p>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl font-black text-brand-white">{filteredExpenses?.length || 0}</span>
                                <span className="text-sm font-bold text-brand-white/60">Items</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col md:flex-row gap-3 items-center w-full lg:w-auto">
                    <div className="relative group flex-1 sm:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-navy/40 transition-colors group-focus-within:text-brand-navy" />
                        <Input
                            placeholder="Find expense..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-11 h-12 bg-white/50 border-none shadow-sm rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-bold text-brand-navy"
                        />
                    </div>

                    <Select value={selectedType} onValueChange={setSelectedType}>
                        <SelectTrigger className="w-full sm:w-[200px] h-12 bg-white/50 border-none shadow-sm rounded-2xl font-bold text-brand-navy focus:ring-1 focus:ring-brand-navy/20">
                            <div className="flex items-center gap-2">
                                <Filter className="w-4 h-4 text-brand-navy/40" />
                                <SelectValue placeholder="All Categories" />
                            </div>
                        </SelectTrigger>
                        <SelectContent className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white">
                            <SelectItem value="all" className="rounded-xl p-3 font-bold uppercase text-[10px] tracking-widest text-brand-navy focus:bg-brand-navy focus:text-brand-white">All Categories</SelectItem>
                            {expenseTypes?.map((type: any) => (
                                <SelectItem key={type.id} value={type.id} className="rounded-xl p-3 font-bold uppercase text-[10px] tracking-widest text-brand-navy focus:bg-brand-navy focus:text-brand-white">
                                    {type.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Button
                        onClick={() => openUpsert()}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-12 px-6 font-bold shadow-lg shadow-brand-navy/10 transition-all active:scale-95 flex items-center gap-2 w-full sm:w-auto"
                    >
                        <Plus className="w-5 h-5" />
                        Add Expense
                    </Button>
                </div>
            </div>

            {/* List display */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {isExpensesLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-56 w-full rounded-[40px] bg-brand-navy/5" />
                    ))
                ) : filteredExpenses?.length === 0 ? (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-4">
                        <div className="w-24 h-24 bg-brand-navy/5 rounded-full flex items-center justify-center text-brand-navy/20">
                            <DollarSign className="w-12 h-12" />
                        </div>
                        <div className="space-y-1 text-brand-navy">
                            <p className="text-xl font-bold">No records found</p>
                            <p className="font-medium opacity-60">Your wallet seems safe... for now.</p>
                        </div>
                    </div>
                ) : (
                    filteredExpenses?.map((expense: any) => (
                        <ExpenseCard
                            key={expense.id}
                            expense={expense}
                            onEdit={() => openUpsert(expense)}
                            onDelete={() => setExpenseToDelete(expense)}
                        />
                    ))
                )}
            </div>

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            <DialogHeader className="p-10 pb-4">
                                <DialogTitle className="text-3xl font-black text-brand-navy uppercase tracking-tight">
                                    {editingExpense ? 'Modify Expense' : 'Log Expense'}
                                </DialogTitle>
                                <DialogDescription className="text-brand-navy/60 text-lg font-medium">
                                    Recording every interaction is vital for accurate analytics.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="p-10 pt-4 space-y-6 max-h-[60vh] overflow-y-auto no-scrollbar">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Item / Service Name</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. Office Supplies" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-lg font-bold text-brand-navy shadow-inner" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="type_id"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Category Selection</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-14 rounded-2xl border-none bg-brand-navy/5 text-lg font-bold text-brand-navy shadow-inner">
                                                            <SelectValue placeholder="Choose type" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white">
                                                        {expenseTypes?.map((type: any) => (
                                                            <SelectItem key={type.id} value={type.id} className="rounded-xl p-3 font-bold uppercase text-[10px] tracking-widest text-brand-navy focus:bg-brand-navy focus:text-brand-white">
                                                                {type.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <FormField
                                        control={form.control}
                                        name="amount"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2">
                                                <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Amount (DH)</FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-lg font-bold text-brand-navy shadow-inner" />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="date"
                                        render={({ field }) => (
                                            <FormItem className="space-y-2 flex flex-col pt-0.5">
                                                <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40 pt-1.5">Transaction Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant={"ghost"}
                                                                className={cn(
                                                                    "h-14 w-full pl-3 text-left font-bold text-lg rounded-2xl bg-brand-navy/5 text-brand-navy border-none shadow-inner",
                                                                    !field.value && "text-muted-foreground"
                                                                )}
                                                            >
                                                                {field.value ? (
                                                                    format(field.value, "PPP")
                                                                ) : (
                                                                    <span>Pick a date</span>
                                                                )}
                                                                <Calendar className="ml-auto h-4 w-4 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 border-none shadow-2xl rounded-3xl overflow-hidden" align="start">
                                                        <CalendarComponent
                                                            mode="single"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            disabled={(date) =>
                                                                date > new Date() || date < new Date("1900-01-01")
                                                            }
                                                            initialFocus
                                                            className="bg-brand-white p-4"
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="description"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2">
                                            <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Description & Notes</FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    placeholder="Add any extra details or proof information here..."
                                                    {...field}
                                                    className="min-h-[120px] rounded-3xl border-none bg-brand-navy/5 text-base font-medium text-brand-navy shadow-inner p-5"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <DialogFooter className="p-10 pt-4 bg-brand-white border-t border-brand-navy/5">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setIsUpsertOpen(false)}
                                    className="rounded-2xl h-14 px-8 font-bold text-brand-navy hover:bg-brand-navy/5"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-2xl h-14 px-10 font-bold shadow-2xl shadow-brand-navy/20 transition-all active:scale-95 flex items-center gap-3"
                                >
                                    {upsertMutation.isPending && <Loader2 className="w-5 h-5 animate-spin" />}
                                    {editingExpense ? 'Save Changes' : 'Post Transaction'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!expenseToDelete} onOpenChange={() => setExpenseToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-10 max-w-md bg-brand-white">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 shadow-inner">
                            <Trash2 className="w-10 h-10" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-black text-brand-navy uppercase">Void Transaction?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg font-medium text-brand-navy/60 pt-2">
                                You are about to remove <span className="font-bold text-brand-navy italic">"{expenseToDelete?.name}"</span> of <span className="text-red-500 font-black">{expenseToDelete?.amount} DH</span>. This is irreversible.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/5 hover:bg-brand-navy/10 text-brand-navy m-0">
                                Safety Back
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(expenseToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Void Permanently
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// --- Sub-components ---

const ExpenseCard = ({ expense, onEdit, onDelete }: any) => {
    return (
        <Card className="group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[40px] cursor-default p-1 pb-7">
            <div className="p-7 space-y-6">
                <div className="flex justify-between items-start">
                    <div className="w-14 h-14 bg-brand-navy/[0.04] rounded-2xl flex items-center justify-center text-brand-navy group-hover:bg-brand-navy group-hover:text-white transition-all duration-500 -rotate-3 group-hover:rotate-0">
                        <Receipt className="w-6 h-6" />
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl hover:bg-brand-navy/5 text-brand-navy/30 hover:text-brand-navy transition-colors">
                                <MoreVertical className="h-5 w-5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white animate-in zoom-in-95">
                            <DropdownMenuItem onClick={onEdit} className="rounded-xl p-4 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3 group/item">
                                <Edit2 className="w-5 h-5 text-brand-navy group-focus:text-brand-white" />
                                <span className="font-bold uppercase text-[10px] tracking-widest">Adjust Record</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-brand-navy/5" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-xl p-4 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                <Trash2 className="w-5 h-5" />
                                <span className="font-bold uppercase text-[10px] tracking-widest">Void Record</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="space-y-4">
                    <div className="space-y-1">
                        <div className="flex items-center gap-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-navy/40">
                                {expense.expense_types?.name || 'Uncategorized'}
                            </p>
                        </div>
                        <h3 className="text-xl font-black text-brand-navy tracking-tight line-clamp-1 uppercase">
                            {expense.name}
                        </h3>
                    </div>

                    <div className="bg-brand-navy/[0.02] border border-brand-navy/[0.03] p-5 rounded-3xl space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-brand-navy/60">
                                <Calendar className="w-4 h-4" />
                                <span className="text-xs font-bold leading-none">{format(new Date(expense.date), 'MMMM d, yyyy')}</span>
                            </div>
                            <div className="flex items-baseline gap-0.5">
                                <span className="text-2xl font-black text-brand-navy">{Number(expense.amount).toLocaleString()}</span>
                                <span className="text-[10px] font-black text-brand-navy/40 uppercase">dh</span>
                            </div>
                        </div>
                        {expense.description && (
                            <div className="pt-2 border-t border-brand-navy/[0.05]">
                                <p className="text-[11px] font-medium text-brand-navy/50 italic line-clamp-2">
                                    "{expense.description}"
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 text-brand-blue" />
                        <span className="text-[10px] font-black uppercase text-brand-blue tracking-widest">Post Verified</span>
                    </div>
                    <div className="flex -space-x-2">
                        <Button variant="ghost" size="icon" onClick={onEdit} className="h-10 w-10 text-brand-navy/20 group-hover:text-brand-navy group-hover:bg-brand-navy/5 transition-all rounded-xl">
                            <ChevronRight className="w-5 h-5" />
                        </Button>
                    </div>
                </div>
            </div>
        </Card>
    );
};

export default ExpensesDetails;
