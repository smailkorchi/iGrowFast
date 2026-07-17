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
    Repeat,
    CalendarClock,
    Layers,
    Wallet,
    Sun,
    CalendarDays,
    CalendarRange,
    Tag,
    Sparkles,
    Calendar as CalendarIcon,
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
import { Switch } from "@/components/ui/switch";
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

type Frequency = 'daily' | 'monthly' | 'yearly';

const recurringSchema = z
    .object({
        name: z.string().min(2, 'Name must be at least 2 characters'),
        type_id: z.string().uuid().optional().or(z.literal('')),
        amount: z.coerce.number().min(0.01, 'Amount must be greater than 0'),
        frequency: z.enum(['daily', 'monthly', 'yearly']),
        start_date: z.date({ required_error: 'Pick a start date' }),
        end_date: z.date().optional().nullable(),
        active: z.boolean().default(true),
        description: z.string().optional(),
    })
    .refine((v) => !v.end_date || v.end_date >= v.start_date, {
        message: 'End date must be on or after the start date',
        path: ['end_date'],
    });

type RecurringFormValues = z.infer<typeof recurringSchema>;

// Normalise any cadence to an approximate monthly figure, purely for the
// "run-rate" KPI. 365/12 ≈ 30.44 days per month on average.
const monthlyEquivalent = (amount: number, frequency: Frequency): number => {
    if (frequency === 'daily') return amount * (365 / 12);
    if (frequency === 'yearly') return amount / 12;
    return amount;
};

const FREQUENCY_META: Record<Frequency, { label: string; icon: LucideIcon; tone: string }> = {
    daily: { label: 'Daily', icon: Sun, tone: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    monthly: { label: 'Monthly', icon: CalendarDays, tone: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    yearly: { label: 'Yearly', icon: CalendarRange, tone: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
};

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const Kpi: React.FC<{
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

const RecurringCharges = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);
    const [toDelete, setToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [freqFilter, setFreqFilter] = useState<'all' | Frequency>('all');

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: charges, isLoading } = useQuery({
        queryKey: ['recurring_charges', activeBusinessId],
        staleTime: 5 * 60 * 1000, // tail audit: reference/config data; mutations invalidate
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('recurring_charges' as any)
                .select('*, expense_types(name)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false }) as any);
            if (error) throw error;
            return data;
        },
    });

    // Recurring charges use RECURRENT categories only (the flag toggled in
    // Expense Types). Variable categories belong to manual Expenses. Sub-key
    // stays under the ['expense_types', biz] prefix Expense Types invalidates.
    const { data: expenseTypes } = useQuery({
        queryKey: ['expense_types', activeBusinessId, 'recurrent'],
        staleTime: 5 * 60 * 1000, // tail audit: reference/config data; mutations invalidate
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('expense_types' as any)
                .select('*')
                .eq('active', true)
                .eq('recurrent', true)
                .eq('DigiCom Business', activeBusinessId)
                .order('name', { ascending: true }) as any);
            if (error) throw error;
            return data;
        },
    });

    // Real money already posted to the ledger this month by recurring charges
    // — proves the materialisation is actually running.
    const { data: postedThisMonth } = useQuery({
        queryKey: ['recurring_posted_month', activeBusinessId],
        staleTime: 5 * 60 * 1000, // tail audit: reference/config data; mutations invalidate
        queryFn: async () => {
            if (!activeBusinessId) return 0;
            const { data, error } = await (supabase
                .from('expenses' as any)
                .select('amount, recurring_id, date')
                .eq('DigiCom Business', activeBusinessId)
                .not('recurring_id', 'is', null)
                .gte('date', startOfMonth(new Date()).toISOString()) as any);
            if (error) throw error;
            return (data || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
        },
    });

    const form = useForm<RecurringFormValues>({
        resolver: zodResolver(recurringSchema),
        defaultValues: {
            name: '',
            type_id: '',
            amount: 0,
            frequency: 'monthly',
            start_date: new Date(),
            end_date: null,
            active: true,
            description: '',
        },
    });

    const upsertMutation = useMutation({
        mutationFn: async (values: RecurringFormValues) => {
            const payload = {
                name: values.name,
                type_id: values.type_id ? values.type_id : null,
                amount: values.amount,
                frequency: values.frequency,
                start_date: format(values.start_date, 'yyyy-MM-dd'),
                end_date: values.end_date ? format(values.end_date, 'yyyy-MM-dd') : null,
                active: values.active,
                description: values.description || null,
                'DigiCom Business': activeBusinessId,
            };
            if (editing) {
                const { data, error } = await (supabase
                    .from('recurring_charges' as any)
                    .update(payload)
                    .eq('id', editing.id)
                    .eq('DigiCom Business', activeBusinessId) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await (supabase
                    .from('recurring_charges' as any)
                    .insert(payload) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: (data: any) => {
            // The DB trigger has already (re)materialised the ledger, so refresh
            // every surface that reads expenses.
            queryClient.invalidateQueries({ queryKey: ['recurring_charges'] });
            queryClient.invalidateQueries({ queryKey: ['recurring_posted_month'] });
            queryClient.invalidateQueries({ queryKey: ['expenses'] });
            queryClient.invalidateQueries({ queryKey: ['analytics-expenses'] });
            setIsUpsertOpen(false);
            setEditing(null);
            toast({
                title: editing ? 'Recurring charge updated' : 'Recurring charge created',
                description: `${data.name} — ${FREQUENCY_META[data.frequency as Frequency].label.toLowerCase()} · ${Number(data.amount).toLocaleString()} DH. Past & current occurrences are posted automatically.`,
            });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase
                .from('recurring_charges' as any)
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId) as any);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recurring_charges'] });
            queryClient.invalidateQueries({ queryKey: ['recurring_posted_month'] });
            queryClient.invalidateQueries({ queryKey: ['expenses'] });
            queryClient.invalidateQueries({ queryKey: ['analytics-expenses'] });
            setToDelete(null);
            toast({
                title: 'Recurring charge deleted',
                description: 'The rule was removed. Already-posted expenses are kept as normal records.',
            });
        },
        onError: (error: any) => {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        },
    });

    const handleUpsert = (values: RecurringFormValues) => upsertMutation.mutate(values);

    const openUpsert = (charge: any = null) => {
        if (charge) {
            setEditing(charge);
            form.reset({
                name: charge.name,
                type_id: charge.type_id || '',
                amount: charge.amount,
                frequency: charge.frequency,
                start_date: new Date(charge.start_date),
                end_date: charge.end_date ? new Date(charge.end_date) : null,
                active: charge.active,
                description: charge.description || '',
            });
        } else {
            setEditing(null);
            form.reset({
                name: '',
                type_id: '',
                amount: 0,
                frequency: 'monthly',
                start_date: new Date(),
                end_date: null,
                active: true,
                description: '',
            });
        }
        setIsUpsertOpen(true);
    };

    const filtered = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return (charges || []).filter((c: any) => {
            if (freqFilter !== 'all' && c.frequency !== freqFilter) return false;
            if (!q) return true;
            return (c.name || '').toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
        });
    }, [charges, searchQuery, freqFilter]);

    const stats = useMemo(() => {
        const list = charges || [];
        const active = list.filter((c: any) => c.active);
        const runRate = active.reduce(
            (s: number, c: any) => s + monthlyEquivalent(Number(c.amount || 0), c.frequency),
            0,
        );
        return {
            total: list.length,
            active: active.length,
            runRate,
            postedThisMonth: Number(postedThisMonth || 0),
        };
    }, [charges, postedThisMonth]);

    const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid';
    const inputCls =
        'h-10 rounded-xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40';

    const FREQ_TABS: { key: 'all' | Frequency; label: string }[] = [
        { key: 'all', label: 'All' },
        { key: 'daily', label: 'Daily' },
        { key: 'monthly', label: 'Monthly' },
        { key: 'yearly', label: 'Yearly' },
    ];

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                {/* Editorial header */}
                <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                    <div className="space-y-2">
                        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                            Finance · Fixed costs
                        </div>
                        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Recurring charges
                        </h1>
                        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                            Rent, salaries, subscriptions, warehouse fees — set them once. Each due date is posted to Expenses automatically, so every report reads true without re-entry.
                        </p>
                    </div>
                    <Button
                        onClick={() => openUpsert()}
                        className="bg-ant-ink hover:bg-ant-ink/90 text-white h-10 px-5 rounded-full text-[12px] font-semibold gap-2 shrink-0 cursor-pointer"
                    >
                        <Plus className="w-4 h-4" />
                        New recurring charge
                    </Button>
                </header>

                {/* KPI strip */}
                {isLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                ) : (
                    <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <Kpi label="Active charges" value={String(stats.active)} suffix="live" accent="green" icon={Repeat} />
                        <Kpi label="≈ Monthly run-rate" value={Math.round(stats.runRate).toLocaleString()} suffix="DH/mo" accent="orange" icon={Wallet} />
                        <Kpi label="Posted this month" value={Math.round(stats.postedThisMonth).toLocaleString()} suffix="DH" accent="rose" icon={CalendarClock} />
                        <Kpi label="Total rules" value={String(stats.total)} suffix="defined" accent="ink" icon={Layers} />
                    </section>
                )}

                {/* Toolbar */}
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper overflow-x-auto">
                        {FREQ_TABS.map((t) => {
                            const active = freqFilter === t.key;
                            return (
                                <button
                                    key={t.key}
                                    onClick={() => setFreqFilter(t.key)}
                                    className={cn(
                                        'inline-flex items-center gap-2 rounded-full px-3.5 h-8 text-[12px] font-semibold transition cursor-pointer whitespace-nowrap',
                                        active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink',
                                    )}
                                >
                                    {t.label}
                                </button>
                            );
                        })}
                    </div>

                    <div className="relative w-full md:w-[340px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                        <Input
                            placeholder="Search recurring charges..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                        />
                    </div>
                </div>

                {/* Table */}
                {isLoading ? (
                    <div className="space-y-2">
                        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full rounded-2xl" />)}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Repeat className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                            {charges?.length ? 'No charges match the filters' : 'No recurring charges yet'}
                        </h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            {charges?.length
                                ? 'Relax the search or cadence filter to bring them back.'
                                : 'Add Rent, Salaries, or your ad-tool subscription — the system posts every due date for you.'}
                        </p>
                        {!charges?.length && (
                            <Button
                                onClick={() => openUpsert()}
                                className="mt-5 bg-ant-ink hover:bg-ant-ink/90 text-white h-9 px-5 rounded-full text-[12px] font-semibold gap-2 cursor-pointer"
                            >
                                <Plus className="w-4 h-4" />
                                Add your first one
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Name</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Cadence</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Category</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Window</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Status</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Amount</th>
                                        <th className="px-4 py-3 w-10" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map((c: any) => {
                                        const fm = FREQUENCY_META[c.frequency as Frequency];
                                        const FreqIcon = fm.icon;
                                        return (
                                            <tr key={c.id} className={cn('border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums', !c.active && 'opacity-60')}>
                                                <td className="px-4 py-3">
                                                    <p className="font-display text-[13px] font-semibold text-ant-ink truncate max-w-[220px]">{c.name}</p>
                                                    {c.description && (
                                                        <p className="font-serif italic text-[11px] text-ant-mid truncate max-w-[220px]">{c.description}</p>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', fm.tone)}>
                                                        <FreqIcon className="w-2.5 h-2.5" />
                                                        {fm.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink">
                                                        <Tag className="w-2.5 h-2.5 text-ant-mid" />
                                                        {c.expense_types?.name || 'Uncategorized'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-[11px] text-ant-mid whitespace-nowrap">
                                                    {format(new Date(c.start_date), 'dd MMM yyyy')}
                                                    {c.end_date ? ` → ${format(new Date(c.end_date), 'dd MMM yyyy')}` : ' → ongoing'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={cn(
                                                        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                                        c.active ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-light border-ant-line text-ant-mid',
                                                    )}>
                                                        <span className={cn('h-1.5 w-1.5 rounded-full', c.active ? 'bg-ant-green' : 'bg-ant-mid')} />
                                                        {c.active ? 'Active' : 'Paused'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right font-display text-[14px] font-semibold text-ant-rose tabular-nums whitespace-nowrap">
                                                    −{Number(c.amount).toLocaleString()}
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
                                                            <DropdownMenuItem onClick={() => openUpsert(c)} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-ink gap-2">
                                                                <Edit2 className="w-3.5 h-3.5 text-ant-orange" /> Edit
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="my-1 bg-ant-line" />
                                                            <DropdownMenuItem onClick={() => setToDelete(c)} className="rounded-lg px-3 py-2 cursor-pointer text-[12px] font-medium text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10 gap-2">
                                                                <Trash2 className="w-3.5 h-3.5" /> Delete
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
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
                                        {editing ? 'Edit · Recurring' : 'New · Recurring'}
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                                        {editing ? 'Update recurring charge' : 'Add a recurring charge'}
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                        Set the cadence and the amount. The system posts every due date from the start date onward — including past ones — straight into Expenses.
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto ant-scroll">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <FormField
                                            control={form.control}
                                            name="name"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Name</FormLabel>
                                                    <FormControl>
                                                        <Input placeholder="e.g. Office rent" {...field} className={inputCls} />
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
                                                    <FormLabel className={labelCls}>Category · optional</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value || ''}>
                                                        <FormControl>
                                                            <SelectTrigger className={inputCls}>
                                                                <SelectValue placeholder="Uncategorized" />
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
                                                    {!expenseTypes?.length && (
                                                        <p className="font-serif italic text-[10px] text-ant-mid leading-snug">
                                                            No recurrent categories yet — mark one as Recurrent in Expense Types.
                                                        </p>
                                                    )}
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
                                            name="frequency"
                                            render={({ field }) => (
                                                <FormItem className="space-y-1.5">
                                                    <FormLabel className={labelCls}>Repeats</FormLabel>
                                                    <Select onValueChange={field.onChange} value={field.value}>
                                                        <FormControl>
                                                            <SelectTrigger className={inputCls}>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent className="rounded-xl border-ant-line">
                                                            <SelectItem value="daily" className="text-[12px]">Daily — every day</SelectItem>
                                                            <SelectItem value="monthly" className="text-[12px]">Monthly — same day each month</SelectItem>
                                                            <SelectItem value="yearly" className="text-[12px]">Yearly — same date each year</SelectItem>
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
                                            name="start_date"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-1.5">
                                                    <FormLabel className={labelCls}>Starts</FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'h-10 rounded-xl border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-medium text-ant-ink text-left justify-between gap-2',
                                                                        !field.value && 'text-ant-mid',
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
                                                                disabled={(date) => date < new Date('1900-01-01')}
                                                                initialFocus
                                                            />
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="end_date"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col space-y-1.5">
                                                    <FormLabel className={labelCls}>Ends · optional</FormLabel>
                                                    <Popover>
                                                        <PopoverTrigger asChild>
                                                            <FormControl>
                                                                <Button
                                                                    variant="outline"
                                                                    className={cn(
                                                                        'h-10 rounded-xl border-ant-line bg-ant-paper hover:bg-ant-light text-[12px] font-medium text-ant-ink text-left justify-between gap-2',
                                                                        !field.value && 'text-ant-mid',
                                                                    )}
                                                                >
                                                                    {field.value ? format(field.value, 'dd MMM yyyy') : <span>No end date</span>}
                                                                    <CalendarIcon className="h-3.5 w-3.5 text-ant-mid" />
                                                                </Button>
                                                            </FormControl>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="ant-calendar w-auto p-0 rounded-xl border border-ant-line bg-ant-paper shadow-[0_16px_48px_-20px_rgba(20,20,19,0.2)]" align="start">
                                                            <CalendarComponent
                                                                mode="single"
                                                                selected={field.value || undefined}
                                                                onSelect={field.onChange}
                                                                initialFocus
                                                            />
                                                            {field.value && (
                                                                <div className="p-2 border-t border-ant-line">
                                                                    <Button type="button" variant="ghost" onClick={() => field.onChange(null)} className="w-full h-8 text-[11px] text-ant-mid hover:text-ant-ink rounded-lg">
                                                                        Clear end date
                                                                    </Button>
                                                                </div>
                                                            )}
                                                        </PopoverContent>
                                                    </Popover>
                                                    <FormMessage className="text-ant-rose" />
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    <FormField
                                        control={form.control}
                                        name="active"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-ant-line bg-ant-paper">
                                                <div className="space-y-0.5 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className={cn('h-1.5 w-1.5 rounded-full', field.value ? 'bg-ant-green' : 'bg-ant-mid')} />
                                                        <FormLabel className="text-[12px] font-semibold text-ant-ink">Active</FormLabel>
                                                    </div>
                                                    <p className="font-serif italic text-[11px] text-ant-mid leading-snug">
                                                        Pausing removes its occurrences from the books. To stop it going forward but keep history, set an end date instead.
                                                    </p>
                                                </div>
                                                <FormControl>
                                                    <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-ant-green" />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="description"
                                        render={({ field }) => (
                                            <FormItem className="space-y-1.5">
                                                <FormLabel className={labelCls}>Notes · optional</FormLabel>
                                                <FormControl>
                                                    <Textarea
                                                        placeholder="Contract reference, landlord, anything worth remembering..."
                                                        {...field}
                                                        className="min-h-[72px] rounded-2xl border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid resize-none focus-visible:ring-1 focus-visible:ring-ant-orange/40"
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
                                        {editing ? 'Save changes' : 'Create charge'}
                                    </Button>
                                </DialogFooter>
                            </form>
                        </Form>
                    </DialogContent>
                </Dialog>

                {/* Delete confirmation */}
                <AlertDialog open={!!toDelete} onOpenChange={() => setToDelete(null)}>
                    <AlertDialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <AlertDialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-rose">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                Destructive action
                            </div>
                            <AlertDialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">Delete this recurring charge?</AlertDialogTitle>
                            <AlertDialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                Removing <span className="not-italic font-semibold text-ant-ink">&ldquo;{toDelete?.name}&rdquo;</span> stops all future posting. Occurrences already posted to Expenses are <span className="not-italic font-semibold text-ant-ink">kept</span> as normal records.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="px-6 py-4 gap-2">
                            <AlertDialogCancel className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer border-0">
                                Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(toDelete.id)}
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

export default RecurringCharges;
