import React, { useMemo, useState } from 'react';
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
    Filter,
    Receipt,
    Coins,
    TrendingDown,
    Layers,
    Sparkles,
    Calendar as CalendarIcon,
    Tag,
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
import { format, startOfMonth } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";

const expenseSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    type_id: z.string().uuid("Please select a category"),
    amount: z.coerce.number().min(0.01, "Amount must be greater than 0"),
    date: z.date().default(() => new Date()),
    description: z.string().optional(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const ExpenseKpi: React.FC<{
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

const ExpensesDetails = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<any>(null);
    const [expenseToDelete, setExpenseToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedType, setSelectedType] = useState<string>("all");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

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
                    .insert({ ...payload, 'DigiCom Business': activeBusinessId }) as any)
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
                title: editingExpense ? 'Expense updated' : 'Expense recorded',
                description: `Successfully ${editingExpense ? 'updated' : 'added'} ${data.name} (${data.amount} DH).`
            });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
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
            toast({ title: 'Expense deleted', description: 'The record has been permanently removed.' });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
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

    const filteredExpenses = useMemo(() => {
        return (expenses || []).filter((e: any) => {
            const q = searchQuery.toLowerCase();
            const matchesSearch =
                (e.name?.toLowerCase() || '').includes(q) ||
                (e.description?.toLowerCase() || '').includes(q);
            const matchesType = selectedType === 'all' || e.type_id === selectedType;
            return matchesSearch && matchesType;
        });
    }, [expenses, searchQuery, selectedType]);

    const stats = useMemo(() => {
        const all = expenses || [];
        const monthStart = startOfMonth(new Date());
        const thisMonthTotal = all
            .filter((e: any) => new Date(e.date) >= monthStart)
            .reduce((acc: number, e: any) => acc + Number(e.amount), 0);
        const allTimeTotal = all.reduce((acc: number, e: any) => acc + Number(e.amount), 0);
        const count = all.length;
        const avg = count > 0 ? allTimeTotal / count : 0;
        const filteredTotal = filteredExpenses.reduce((acc: number, e: any) => acc + Number(e.amount), 0);
        return { thisMonthTotal, allTimeTotal, count, avg, filteredTotal };
    }, [expenses, filteredExpenses]);

    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';
    const inputCls =
        'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Finance · Outflows
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Expenses
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Every dirham that leaves the house — rent, fuel, gift boxes, coffee runs. Categorised, dated, receipt-ready.
                        </p>
                    </div>
                    <Button
                        onClick={() => openUpsert()}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        Log expense
                    </Button>
                </header>

                {/* KPI strip */}
                {isExpensesLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <ExpenseKpi label="This month" value={stats.thisMonthTotal.toLocaleString()} suffix="DH" accent="rose" icon={TrendingDown} />
                        <ExpenseKpi label="All time" value={stats.allTimeTotal.toLocaleString()} suffix="DH" accent="orange" icon={Coins} />
                        <ExpenseKpi label="Records" value={stats.count.toLocaleString()} suffix="entries" accent="ink" icon={Layers} />
                        <ExpenseKpi label="Avg ticket" value={Math.round(stats.avg).toLocaleString()} suffix="DH" accent="green" icon={Receipt} />
                    </section>
                )}

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="relative w-full md:w-[340px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search expenses by name or note..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Select value={selectedType} onValueChange={setSelectedType}>
                            <SelectTrigger className="h-10 w-full md:w-[200px] rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink gap-2">
                                <Filter className="w-3.5 h-3.5 text-ant-mid shrink-0" />
                                <SelectValue placeholder="All categories" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl border-ant-line">
                                <SelectItem value="all" className="text-[12px]">All categories</SelectItem>
                                {expenseTypes?.map((type: any) => (
                                    <SelectItem key={type.id} value={type.id} className="text-[12px]">
                                        {type.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {(searchQuery || selectedType !== 'all') && (
                            <span className="font-serif italic text-[11px] text-ant-mid tabular-nums whitespace-nowrap">
                                {filteredExpenses.length} shown · {stats.filteredTotal.toLocaleString()} DH
                            </span>
                        )}
                    </div>
                </div>

                {/* Table */}
                {isExpensesLoading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}
                    </div>
                ) : filteredExpenses.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Receipt className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {expenses?.length ? 'No expenses match the filters' : 'No expenses yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {expenses?.length
                                ? 'Relax the search or category to bring the ledger back into view.'
                                : 'Every cost you track here sharpens your profit picture. Log the first one above.'}
                        </p>
                        {!expenses?.length && (
                            <Button
                                onClick={() => openUpsert()}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <Plus className="w-4 h-4" />
                                Log your first expense
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Date</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Name</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Category</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Note</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Amount</th>
                                        <th className="px-4 py-3 w-10" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredExpenses.map((expense: any) => (
                                        <tr key={expense.id} className="border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums">
                                            <td className="px-4 py-3 text-[11px] text-ant-mid tabular-nums whitespace-nowrap">
                                                {format(new Date(expense.date), 'dd MMM yyyy')}
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="font-display text-[13px] font-semibold text-ant-ink truncate max-w-[240px]">{expense.name}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                                    <Tag className="w-2.5 h-2.5 text-ant-mid" />
                                                    {expense.expense_types?.name || 'Uncategorized'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 font-serif italic text-[12px] text-ant-mid max-w-[220px] truncate">
                                                {expense.description || '—'}
                                            </td>
                                            <td className="px-4 py-3 text-right font-display text-[14px] font-semibold text-ant-rose tabular-nums whitespace-nowrap">
                                                −{Number(expense.amount).toLocaleString()}
                                                <span className="text-[10px] text-ant-mid font-normal ml-1">DH</span>
                                            </td>
                                            <td className="px-2 py-3 text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-ant-ink/5 text-ant-mid cursor-pointer">
                                                            <MoreVertical className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)] p-1 min-w-[140px]">
                                                        <DropdownMenuItem onClick={() => openUpsert(expense)} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                                            <Edit2 className="w-3.5 h-3.5 text-ant-orange" /> Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator className="my-1 bg-ant-line" />
                                                        <DropdownMenuItem onClick={() => setExpenseToDelete(expense)} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 gap-2">
                                                            <Trash2 className="w-3.5 h-3.5" /> Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-ant-ink text-white font-semibold tabular-nums">
                                        <td colSpan={4} className="px-4 py-3.5 text-[10px] uppercase tracking-[0.24em]">
                                            Total shown
                                            <span className="text-white/60 font-normal font-sans normal-case tracking-normal ml-2 tabular-nums">
                                                {filteredExpenses.length} entr{filteredExpenses.length === 1 ? 'y' : 'ies'}
                                            </span>
                                        </td>
                                        <td className="text-right px-4 py-3.5 font-display text-[16px] text-ant-orange">
                                            −{stats.filteredTotal.toLocaleString()} <span className="text-[11px] text-white/55 font-normal">DH</span>
                                        </td>
                                        <td />
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}

                {/* Upsert Modal */}
                <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                    <DialogContent className="max-w-lg p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <Form {...form}>
                            <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                                <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        {editingExpense ? 'Edit · Expense' : 'New · Expense'}
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                                        {editingExpense ? 'Update expense' : 'Log a new expense'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                        Who did you pay, for what, how much. The profit picture sharpens with every honest entry.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto ant-scroll">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Item · Service</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="e.g. Office supplies" {...field} className={inputCls} />
                                                    </FormControl>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="type_id"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Category</FormLabel>
                                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className={inputCls}>
                                                                <SelectValue placeholder="Choose type" />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            {expenseTypes?.map((type: any) => (
                                                                <SelectItem key={type.id} value={type.id} className="text-[12px]">
                                                                    {type.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="amount"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Amount · DH</FormLabel>
                                                    <FormControl>
                                                        <div className="relative">
                                                            <Input type="number" step="0.01" {...field} className={cn(inputCls, 'tabular-nums pr-12')} />
                                                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                                                                DH
                                                            </span>
                                                        </div>
                                                    </FormControl>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="date"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-1.5">
                                                    <FormLabel className={labelCls}>Date</FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'h-10 rounded-xl border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-medium text-ant-ink text-left justify-between gap-2',
                                                                        !field.value && 'text-ant-mid'
                                                                    )}
                                                                >
                                                                    {field.value ? format(field.value, 'dd MMM yyyy') : <span>Pick date</span>}
                                                                    <CalendarIcon className="h-3.5 w-3.5 text-ant-mid" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="ant-calendar w-auto p-0 rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="start">
                                                            <CalendarComponent
                                                                mode="single"
                                                                selected={field.value}
                                                                onSelect={field.onChange}
                                                                disabled={(date) => date > new Date() || date < new Date('1900-01-01')}
                                                                initialFocus
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="description"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Notes · optional</FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        placeholder="Invoice number, context, anything worth remembering..."
                                                        {...field}
                                                        className="min-h-[88px] rounded-2xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid resize-none focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                                    />
                                                </FormControl>
                                                <FormMessage className="text-ant-rose" />
                                            </FormItem>
                                        )}
                                    />
                                </div>

                                <DialogFooter className="px-6 py-4 border-t border-ant-line gap-2">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => setIsUpsertOpen(false)}
                                        className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        type="submit"
                                        disabled={upsertMutation.isPending}
                                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                                    >
                                        {upsertMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                                        {editingExpense ? 'Save changes' : 'Log expense'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                {/* Delete confirmation */}
                <AlertDialog open={!!expenseToDelete} onOpenChange={() => setExpenseToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this expense?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Removing <span className="not-italic font-semibold text-ant-ink">&ldquo;{expenseToDelete?.name}&rdquo;</span> of{' '}
                                <span className="not-italic font-semibold text-ant-rose">{expenseToDelete?.amount} DH</span> is irreversible.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(expenseToDelete.id)}
                                className="h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose hover:bg-ant-rose/90 text-white gap-2 cursor-pointer"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                <Trash2 className="w-3.5 h-3.5" />
                                Confirm delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </div>
    );
};

export default ExpensesDetails;
