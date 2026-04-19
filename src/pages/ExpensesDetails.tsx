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
    Calendar,
    DollarSign,
    Filter,
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
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Expense Tracker</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Track every business expenditure</p>
                    </div>
                    <Button
                        onClick={() => openUpsert()}
                        className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                    >
                        <Plus className="w-3.5 h-3.5" /> Add Expense
                    </Button>
                </div>
            </header>

            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#ef4444' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total Spend</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{totalAmount.toLocaleString()} DH</p>
                    </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full" style={{ background: '#d97706' }} />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Transactions</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{filteredExpenses?.length || 0}</p>
                    </div>
                </div>
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <Input
                        placeholder="Search expenses..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px]"
                    />
                </div>
                <Select value={selectedType} onValueChange={setSelectedType}>
                    <SelectTrigger className="h-8 border-gray-200 bg-white rounded-md text-[11px] w-44 gap-1.5">
                        <Filter className="w-3 h-3 text-gray-400" />
                        <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all" className="text-[11px]">All Categories</SelectItem>
                        {expenseTypes?.map((type: any) => (
                            <SelectItem key={type.id} value={type.id} className="text-[11px]">
                                {type.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Table */}
            <Card className="border border-gray-100 shadow-none rounded-xl overflow-hidden">
                <CardContent className="p-0">
                    {isExpensesLoading ? (
                        <div className="p-4 space-y-2">
                            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
                        </div>
                    ) : filteredExpenses?.length === 0 ? (
                        <div className="border border-dashed border-gray-200 rounded-xl mx-3.5 my-3.5 py-8 flex flex-col items-center justify-center text-center gap-2">
                            <Receipt className="w-5 h-5 text-gray-300" />
                            <p className="text-[11px] font-semibold text-brand-navy">No records found</p>
                            <p className="text-[10px] text-gray-400">Add your first expense to start tracking.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-100">
                                        <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Date</th>
                                        <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Name</th>
                                        <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Category</th>
                                        <th className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Note</th>
                                        <th className="px-3 py-2 text-right text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold">Amount</th>
                                        <th className="px-3 py-2 w-10" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredExpenses?.map((expense: any) => (
                                        <tr key={expense.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                                            <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums whitespace-nowrap">
                                                {format(new Date(expense.date), 'dd MMM yyyy')}
                                            </td>
                                            <td className="px-3 py-2 text-[11px] text-brand-navy/80 font-medium">{expense.name}</td>
                                            <td className="px-3 py-2">
                                                <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                                    {expense.expense_types?.name || 'Uncategorized'}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-[11px] text-gray-400 italic max-w-[180px] truncate">
                                                {expense.description || '—'}
                                            </td>
                                            <td className="px-3 py-2 text-right text-[11px] font-semibold text-brand-navy tabular-nums whitespace-nowrap">
                                                {Number(expense.amount).toLocaleString()} DH
                                            </td>
                                            <td className="px-2 py-2">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-md hover:bg-gray-100 text-gray-400">
                                                            <MoreVertical className="h-3 w-3" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-lg border border-gray-100 shadow-sm p-1 min-w-[120px]">
                                                        <DropdownMenuItem onClick={() => openUpsert(expense)} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2">
                                                            <Edit2 className="w-3.5 h-3.5 text-gray-400" /> Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator className="my-1" />
                                                        <DropdownMenuItem onClick={() => setExpenseToDelete(expense)} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2 text-red-500">
                                                            <Trash2 className="w-3.5 h-3.5" /> Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-md p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                                <DialogTitle className="text-[13px] font-semibold text-brand-navy">
                                    {editingExpense ? 'Edit Expense' : 'Add Expense'}
                                </DialogTitle>
                            </DialogHeader>

                            <div className="p-4 space-y-3 bg-white max-h-[65vh] overflow-y-auto">
                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-semibold text-gray-600">Item / Service</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="e.g. Office Supplies" {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                                </FormControl>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="type_id"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-semibold text-gray-600">Category</FormLabel>
                                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-8 text-[11px] rounded-md border-gray-200">
                                                            <SelectValue placeholder="Choose type" />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {expenseTypes?.map((type: any) => (
                                                            <SelectItem key={type.id} value={type.id} className="text-[11px]">
                                                                {type.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="amount"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-[10px] font-semibold text-gray-600">Amount (DH)</FormLabel>
                                                <FormControl>
                                                    <Input type="number" step="0.01" {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                                </FormControl>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="date"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col">
                                                <FormLabel className="text-[10px] font-semibold text-gray-600">Date</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                        <FormControl>
                                                            <Button
                                                                variant={"outline"}
                                                                className={cn(
                                                                    "h-8 w-full pl-3 text-left text-[11px] rounded-md border-gray-200",
                                                                    !field.value && "text-gray-400"
                                                                )}
                                                            >
                                                                {field.value ? format(field.value, "dd MMM yyyy") : <span>Pick date</span>}
                                                                <Calendar className="ml-auto h-3.5 w-3.5 opacity-50" />
                                                            </Button>
                                                        </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0 border border-gray-100 shadow-sm rounded-xl overflow-hidden" align="start">
                                                        <CalendarComponent
                                                            mode="single"
                                                            selected={field.value}
                                                            onSelect={field.onChange}
                                                            disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                                                            initialFocus
                                                        />
                                                    </PopoverContent>
                                                </Popover>
                                                <FormMessage className="text-[10px]" />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <FormField
                                    control={form.control}
                                    name="description"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-semibold text-gray-600">Notes</FormLabel>
                                            <FormControl>
                                                <Textarea
                                                    placeholder="Optional notes..."
                                                    {...field}
                                                    className="min-h-[72px] rounded-lg border-gray-200 text-[11px] resize-none"
                                                />
                                            </FormControl>
                                            <FormMessage className="text-[10px]" />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <DialogFooter className="px-4 py-3 border-t border-gray-100 bg-white gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setIsUpsertOpen(false)}
                                    className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={upsertMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5"
                                >
                                    {upsertMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                    {editingExpense ? 'Save Changes' : 'Add Expense'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!expenseToDelete} onOpenChange={() => setExpenseToDelete(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl border border-gray-100 p-4">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[13px] font-semibold text-brand-navy">Delete expense?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            Removing <span className="font-semibold text-brand-navy">"{expenseToDelete?.name}"</span> of{' '}
                            <span className="text-red-500 font-semibold">{expenseToDelete?.amount} DH</span> is irreversible.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 mt-3">
                        <AlertDialogCancel className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteMutation.mutate(expenseToDelete.id)}
                            className="h-8 px-3 rounded-md text-[11px] font-semibold bg-red-500 hover:bg-red-600 text-white"
                        >
                            {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ExpensesDetails;
