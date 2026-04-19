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
    Repeat,
    Receipt,
    Wallet,
    Calendar,
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
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// --- Schema ---
const expenseTypeSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    active: z.boolean().default(true),
    recurrent: z.boolean().default(false),
});

type ExpenseTypeFormValues = z.infer<typeof expenseTypeSchema>;

const ExpensesTypes = () => {
    const [isUpsertOpen, setIsUpsertOpen] = useState(false);
    const [editingType, setEditingType] = useState<any>(null);
    const [typeToDelete, setTypeToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: expenseTypes, isLoading } = useQuery({
        queryKey: ['expense_types', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase
                .from('expense_types' as any)
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('name', { ascending: true }) as any);

            if (error) throw error;
            return data;
        },
    });

    // --- Form Setup ---
    const form = useForm<ExpenseTypeFormValues>({
        resolver: zodResolver(expenseTypeSchema),
        defaultValues: {
            name: '',
            active: true,
            recurrent: false,
        }
    });

    // --- Mutations ---
    const upsertMutation = useMutation({
        mutationFn: async (values: ExpenseTypeFormValues) => {
            if (editingType) {
                const { data, error } = await (supabase
                    .from('expense_types' as any)
                    .update({ ...values, 'DigiCom Business': activeBusinessId })
                    .eq('id', editingType.id)
                    .eq('DigiCom Business', activeBusinessId) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            } else {
                const { data, error } = await (supabase
                    .from('expense_types' as any)
                    .insert({
                        ...values,
                        'DigiCom Business': activeBusinessId
                    }) as any)
                    .select()
                    .single();
                if (error) throw error;
                return data;
            }
        },
        onSuccess: (data: any) => {
            queryClient.invalidateQueries({ queryKey: ['expense_types', activeBusinessId] });
            setIsUpsertOpen(false);
            setEditingType(null);
            toast({
                title: editingType ? "Type updated" : "Type created",
                description: `Successfully ${editingType ? 'updated' : 'created'} ${data.name}.`
            });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await (supabase
                .from('expense_types' as any)
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId) as any);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['expense_types', activeBusinessId] });
            setTypeToDelete(null);
            toast({ title: "Type deleted", description: "The expense type was successfully removed." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: "This type might be linked to existing expenses.", variant: "destructive" });
        }
    });

    const handleUpsert = (values: ExpenseTypeFormValues) => {
        upsertMutation.mutate(values);
    };

    const openUpsert = (type: any = null) => {
        if (type) {
            setEditingType(type);
            form.reset({
                name: type.name,
                active: type.active,
                recurrent: type.recurrent,
            });
        } else {
            setEditingType(null);
            form.reset({
                name: '',
                active: true,
                recurrent: false,
            });
        }
        setIsUpsertOpen(true);
    };

    const filteredTypes = expenseTypes?.filter((t: any) =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Expense Categories</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Manage and organize business spending types</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search categories..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-48"
                            />
                        </div>
                        <Button
                            onClick={() => openUpsert()}
                            className="bg-brand-navy hover:bg-brand-navy/90 text-white h-8 px-3 rounded-md text-[11px] font-semibold gap-1.5 shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5" /> New Category
                        </Button>
                    </div>
                </div>
            </header>

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-28 w-full rounded-xl" />
                    ))
                ) : filteredTypes?.length === 0 ? (
                    <div className="col-span-full border border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center justify-center text-center gap-2">
                        <Receipt className="w-5 h-5 text-gray-300" />
                        <p className="text-[11px] font-semibold text-brand-navy">No categories found</p>
                        <p className="text-[10px] text-gray-400">Create your first expense category to start tracking costs.</p>
                    </div>
                ) : (
                    filteredTypes?.map((type: any) => (
                        <ExpenseTypeCard
                            key={type.id}
                            type={type}
                            onEdit={() => openUpsert(type)}
                            onDelete={() => setTypeToDelete(type)}
                        />
                    ))
                )}
            </div>

            {/* Upsert Modal */}
            <Dialog open={isUpsertOpen} onOpenChange={setIsUpsertOpen}>
                <DialogContent className="max-w-sm p-0 border border-gray-100 rounded-xl shadow-none overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            <DialogHeader className="px-4 pt-4 pb-3 border-b border-gray-100">
                                <DialogTitle className="text-[13px] font-semibold text-brand-navy">
                                    {editingType ? 'Edit Category' : 'New Category'}
                                </DialogTitle>
                            </DialogHeader>

                            <div className="p-4 space-y-3 bg-white">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel className="text-[10px] font-semibold text-gray-600">Category Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="e.g. Marketing, Salary, Rent" {...field} className="h-8 text-[11px] rounded-md border-gray-200" />
                                            </FormControl>
                                            <FormMessage className="text-[10px]" />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-2">
                                    <FormField
                                        control={form.control}
                                        name="recurrent"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                                <div>
                                                    <FormLabel className="text-[10px] font-semibold text-brand-navy">Recurrent</FormLabel>
                                                    <p className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Monthly/Annual</p>
                                                </div>
                                                <FormControl>
                                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="active"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                                                <div>
                                                    <FormLabel className="text-[10px] font-semibold text-brand-navy">Active</FormLabel>
                                                    <p className="text-[9px] text-gray-400 uppercase tracking-wide mt-0.5">Status</p>
                                                </div>
                                                <FormControl>
                                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
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
                                    {editingType ? 'Update' : 'Create'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!typeToDelete} onOpenChange={() => setTypeToDelete(null)}>
                <AlertDialogContent className="max-w-sm rounded-xl border border-gray-100 p-4">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-[13px] font-semibold text-brand-navy">Remove category?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[11px] text-gray-500">
                            Deleting <span className="font-semibold text-brand-navy">"{typeToDelete?.name}"</span> cannot be undone if expenses are linked.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2 mt-3">
                        <AlertDialogCancel className="h-8 px-3 rounded-md text-[11px] font-semibold border-gray-200">
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteMutation.mutate(typeToDelete.id)}
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

// --- Sub-components ---

const ExpenseTypeCard = ({ type, onEdit, onDelete }: any) => {
    return (
        <Card className={cn("border border-gray-100 shadow-none rounded-xl overflow-hidden cursor-default", !type.active && "opacity-60")}>
            <div className={cn("h-[3px] w-full", type.active ? (type.recurrent ? "bg-amber-400" : "bg-brand-navy/40") : "bg-gray-200")} />
            <CardContent className="p-3.5 space-y-3">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-1.5 mb-1">
                            <h3 className="text-[12px] font-semibold text-brand-navy leading-tight line-clamp-1">
                                {type.name}
                            </h3>
                            {type.recurrent && <Repeat className="w-3 h-3 text-amber-500 shrink-0" />}
                        </div>
                        <Badge className={cn(
                            "h-5 px-1.5 text-[9px] border-none font-semibold",
                            type.active ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"
                        )}>
                            {type.active ? "Active" : "Inactive"}
                        </Badge>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md hover:bg-gray-100 text-gray-400">
                                <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-lg border border-gray-100 shadow-sm p-1 min-w-[130px]">
                            <DropdownMenuItem onClick={onEdit} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2">
                                <Edit2 className="w-3.5 h-3.5 text-gray-400" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-md px-2 py-1.5 cursor-pointer text-[11px] font-medium gap-2 text-red-500">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="flex items-center gap-1.5 pt-1 border-t border-gray-100">
                    {type.recurrent ? (
                        <Calendar className="w-3 h-3 text-amber-500" />
                    ) : (
                        <Wallet className="w-3 h-3 text-brand-navy/40" />
                    )}
                    <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                        {type.recurrent ? "Fixed Cost" : "Variable"}
                    </span>
                </div>
            </CardContent>
        </Card>
    );
};

export default ExpensesTypes;
