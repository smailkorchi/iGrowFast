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
    Repeat,
    Receipt,
    Wallet,
    Calendar,
    ArrowRight
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
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Expense Categories</h1>
                            <p className="text-gray-500 font-light">Manage and organize your business spending types.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search categories..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => openUpsert()}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Plus className="w-5 h-5" />
                                New Category
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Grid display */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-48 w-full rounded-[32px] bg-brand-navy/5" />
                    ))
                ) : filteredTypes?.length === 0 ? (
                    <div className="col-span-full py-20 flex flex-col items-center justify-center text-center space-y-4">
                        <div className="w-20 h-20 bg-brand-navy/5 rounded-full flex items-center justify-center text-brand-navy/20">
                            <Receipt className="w-10 h-10" />
                        </div>
                        <div className="space-y-1 text-brand-navy">
                            <p className="text-xl font-bold">No categories found</p>
                            <p className="font-medium opacity-60">Try adjusting your search or create a new one.</p>
                        </div>
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
                <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpsert)} className="flex flex-col">
                            <DialogHeader className="p-8 pb-4">
                                <DialogTitle className="text-3xl font-black text-brand-navy uppercase tracking-tight">
                                    {editingType ? 'Edit Category' : 'New Category'}
                                </DialogTitle>
                                <DialogDescription className="text-brand-navy/60 text-lg font-medium">
                                    Configure your expense classification.
                                </DialogDescription>
                            </DialogHeader>

                            <div className="p-8 pt-4 space-y-6">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2">
                                            <FormLabel className="text-xs font-black uppercase tracking-wider text-brand-navy/40">Category Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="e.g. Marketing, Salary, Rent" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/5 text-lg font-bold text-brand-navy shadow-inner" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <div className="grid grid-cols-2 gap-4">
                                    <FormField
                                        control={form.control}
                                        name="recurrent"
                                        render={({ field }) => (
                                            <FormItem className="flex items-center justify-between p-5 rounded-2xl bg-brand-navy/5 border border-brand-navy/5 transition-all">
                                                <div className="space-y-0.5">
                                                    <FormLabel className="text-sm font-black text-brand-navy uppercase tracking-tight">Recurrent</FormLabel>
                                                    <p className="text-[10px] font-bold text-brand-navy/40 uppercase">Monthly/Annual</p>
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
                                            <FormItem className="flex items-center justify-between p-5 rounded-2xl bg-brand-navy/5 border border-brand-navy/5 transition-all">
                                                <div className="space-y-0.5">
                                                    <FormLabel className="text-sm font-black text-brand-navy uppercase tracking-tight">Active</FormLabel>
                                                    <p className="text-[10px] font-bold text-brand-navy/40 uppercase">Usage Status</p>
                                                </div>
                                                <FormControl>
                                                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            <DialogFooter className="p-8 pt-4 bg-brand-white border-t border-brand-navy/5">
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
                                    {editingType ? 'Update Category' : 'Create Category'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!typeToDelete} onOpenChange={() => setTypeToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-10 max-w-md bg-brand-white">
                    <div className="flex flex-col items-center text-center space-y-6">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center text-red-500 shadow-inner">
                            <Trash2 className="w-10 h-10" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-3xl font-black text-brand-navy uppercase">Remove Category?</AlertDialogTitle>
                            <AlertDialogDescription className="text-lg font-medium text-brand-navy/60 pt-2">
                                You are about to delete <span className="font-bold text-brand-navy italic">"{typeToDelete?.name}"</span>. This action cannot be undone if expenses are linked.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="w-full flex flex-col sm:flex-row gap-3 mt-4">
                            <AlertDialogCancel className="w-full rounded-2xl h-14 font-bold border-none bg-brand-navy/5 hover:bg-brand-navy/10 text-brand-navy m-0">
                                Go Back
                            </AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => deleteMutation.mutate(typeToDelete.id)}
                                className="w-full rounded-2xl h-14 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-xl shadow-red-500/20 m-0"
                            >
                                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Confirm Delete
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </div>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// --- Sub-components ---

const ExpenseTypeCard = ({ type, onEdit, onDelete }: any) => {
    return (
        <Card
            className={cn(
                "group relative overflow-hidden border-none bg-white/50 backdrop-blur-sm shadow-sm hover:shadow-2xl transition-all duration-500 rounded-[32px] cursor-default",
                !type.active && "opacity-60 bg-brand-navy/[0.02]"
            )}
        >
            <div
                className={cn(
                    "absolute top-0 left-0 w-full h-2",
                    type.active ? (type.recurrent ? "bg-amber-400" : "bg-brand-blue") : "bg-slate-300"
                )}
            />

            <CardContent className="p-7 space-y-6">
                <div className="flex justify-between items-start">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <h3 className="text-2xl font-black text-brand-navy group-hover:text-brand-navy/70 transition-colors uppercase leading-tight line-clamp-1">
                                {type.name}
                            </h3>
                            {type.recurrent && (
                                <div className="p-1.5 bg-amber-50 rounded-lg text-amber-500" title="Recurrent">
                                    <Repeat className="w-4 h-4" />
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className={cn(
                                "text-[10px] font-black tracking-widest uppercase py-1 px-3 rounded-xl border-none",
                                type.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"
                            )}>
                                {type.active ? "Operational" : "Inactive"}
                            </Badge>
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-12 w-12 rounded-2xl bg-brand-navy/5 text-brand-navy hover:bg-brand-navy/10 transition-colors">
                                <MoreVertical className="h-5 w-5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 min-w-[180px] bg-brand-white animate-in zoom-in-95">
                            <DropdownMenuItem onClick={onEdit} className="rounded-xl p-4 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3 group/item">
                                <Edit2 className="w-5 h-5 text-brand-navy group-focus:text-brand-white" />
                                <span className="font-bold uppercase text-xs">Edit Settings</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-brand-navy/5" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-xl p-4 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3">
                                <Trash2 className="w-5 h-5 text-red-500" />
                                <span className="font-bold uppercase text-xs">Remove Type</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-brand-navy/5">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-brand-navy/40 uppercase tracking-widest">Type Scope</span>
                        <div className="flex items-center gap-1.5 pt-1">
                            {type.recurrent ? (
                                <>
                                    <Calendar className="w-3.5 h-3.5 text-amber-500" />
                                    <span className="text-xs font-bold text-brand-navy uppercase">Fixed Cost</span>
                                </>
                            ) : (
                                <>
                                    <Wallet className="w-3.5 h-3.5 text-brand-blue" />
                                    <span className="text-xs font-bold text-brand-navy uppercase">Variable flow</span>
                                </>
                            )}
                        </div>
                    </div>

                    <Button variant="ghost" size="icon" className="h-10 w-10 text-brand-navy/20 group-hover:text-brand-navy group-hover:bg-brand-navy/5 transition-all rounded-xl">
                        <ArrowRight className="w-5 h-5" />
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

export default ExpensesTypes;
