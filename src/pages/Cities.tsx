import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MapPin,
    Trash2,
    Loader2,
    Pencil,
    Globe
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
    FormMessage
} from '@/components/ui/form';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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

const citySchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    zone_id: z.string().uuid("Please select a valid zone"),
    ameex_code: z.string().optional().nullable(),
});

type CityFormValues = z.infer<typeof citySchema>;

const Cities = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingCity, setEditingCity] = useState<any>(null);
    const [cityToDelete, setCityToDelete] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const { toast } = useToast();
    const queryClient = useQueryClient();

    // --- Queries ---
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: zones } = useQuery({
        queryKey: ['zones', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('zones')
                .select('id, name')
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        },
    });

    const { data: cities, isLoading } = useQuery({
        queryKey: ['master-cities', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('master_cities')
                .select('*, zones(name), ameex:ameex_cities(name, ameex_city_id), coliaty:coliaty_cities(city_name), ozonexpress:ozonexpress_cities(name, ozon_city_id)')
                .eq('DigiCom Business', activeBusinessId)
                .order('name');

            if (error) throw error;
            return data;
        },
    });

    // --- Mutations ---
    const addCityMutation = useMutation({
        mutationFn: async (values: CityFormValues) => {
            const { data, error } = await supabase
                .from('master_cities')
                .insert({
                    name: values.name,
                    zone_id: values.zone_id,
                    'DigiCom Business': activeBusinessId
                })
                .select('*, zones(name)')
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['master-cities'] });
            setIsModalOpen(false);
            toast({ title: "City created", description: "The city has been successfully added to Master Cities." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const updateCityMutation = useMutation({
        mutationFn: async (values: CityFormValues & { id: string }) => {
            const { data, error } = await supabase
                .from('master_cities')
                .update({
                    name: values.name,
                    zone_id: values.zone_id,
                    'DigiCom Business': activeBusinessId
                })
                .eq('id', values.id)
                .select('*, zones(name)')
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['master-cities'] });
            setIsModalOpen(false);
            setEditingCity(null);
            toast({ title: "City updated", description: "The city has been successfully updated." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteCityMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('master_cities')
                .delete()
                .eq('id', id);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['master-cities'] });
            setCityToDelete(null);
            toast({ title: "City deleted", description: "The city was successfully removed." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const filteredCities = cities?.filter(city =>
        city.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (city.zones as any)?.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const form = useForm<CityFormValues>({
        resolver: zodResolver(citySchema),
        defaultValues: {
            name: '',
            zone_id: '',
            ameex_code: '',
        }
    });

    const onSubmit = (values: CityFormValues) => {
        if (editingCity) {
            updateCityMutation.mutate({ ...values, id: editingCity.id });
        } else {
            addCityMutation.mutate(values);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header Section */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Cities & Localities</h1>
                            <p className="text-gray-500 font-light">Manage your service area cities and regional hubs.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search cities or zones..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => {
                                    setEditingCity(null);
                                    form.reset({ name: '', zone_id: '', ameex_code: '' });
                                    setIsModalOpen(true);
                                }}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2"
                            >
                                <Plus className="w-5 h-5" />
                                Add City
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Section */}
            {isLoading ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4">
                    <div className="w-12 h-12 rounded-full border-4 border-brand-navy/10 border-t-brand-navy animate-spin" />
                    <p className="text-muted-foreground font-bold animate-pulse">Loading cities...</p>
                </div>
            ) : filteredCities?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-4 bg-white/50 backdrop-blur-sm rounded-[40px] shadow-sm border border-brand-navy/[0.03]">
                    <div className="w-20 h-20 bg-brand-navy/[0.04] rounded-full flex items-center justify-center">
                        <MapPin className="w-10 h-10 text-brand-navy/20" />
                    </div>
                    <div className="text-center">
                        <h3 className="text-xl font-bold text-brand-navy">No cities found</h3>
                        <p className="text-muted-foreground">Try adjusting your search or add a new city</p>
                    </div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {filteredCities?.map((city) => (
                        <Card
                            key={city.id}
                            className="group relative overflow-hidden border-none bg-white shadow-sm hover:shadow-xl transition-all duration-300 rounded-[32px] p-6 flex flex-col justify-between gap-6"
                        >
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-1.5 flex-1 min-w-0">
                                    <h3 className="text-xl font-bold text-brand-navy truncate leading-tight group-hover:text-brand-navy/80 transition-colors">
                                        {city.name}
                                    </h3>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/60 uppercase tracking-wider">
                                            <MapPin className="w-2.5 h-2.5" />
                                            {(city.zones as any)?.name || 'Unassigned'}
                                        </div>
                                        {city.ameex && (
                                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/60 uppercase tracking-wider">
                                                <Globe className="w-2.5 h-2.5" />
                                                AMEEX: {(city.ameex as any).name}
                                            </div>
                                        )}
                                        {city.coliaty && (
                                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/60 uppercase tracking-wider">
                                                <Globe className="w-2.5 h-2.5" />
                                                Coliaty: {(city.coliaty as any).city_name}
                                            </div>
                                        )}
                                        {city.ozonexpress && (
                                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand-navy/[0.04] text-[10px] font-bold text-brand-navy/60 uppercase tracking-wider">
                                                <Globe className="w-2.5 h-2.5" />
                                                Ozon: {(city.ozonexpress as any).name}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 opacity-10 md:opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-x-2 group-hover:translate-x-0">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                            setEditingCity(city);
                                            form.reset({
                                                name: city.name,
                                                zone_id: city.zone_id,
                                                ameex_code: city.ameex_code || ''
                                            });
                                            setIsModalOpen(true);
                                        }}
                                        className="h-9 w-9 text-brand-navy/40 hover:text-brand-navy hover:bg-brand-navy/5 rounded-full"
                                    >
                                        <Pencil className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => setCityToDelete(city)}
                                        className="h-9 w-9 text-brand-navy/40 hover:text-red-500 hover:bg-red-50 rounded-full"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="relative h-1 w-full bg-brand-navy/[0.03] rounded-full overflow-hidden">
                                <div className="absolute top-0 left-0 h-full bg-brand-navy/10 w-1/4 rounded-full transition-all group-hover:w-1/2" />
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            {/* Add/Edit City Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)}>
                            <DialogHeader className="p-8 pb-4">
                                <DialogTitle className="text-2xl font-bold text-brand-navy">
                                    {editingCity ? 'Edit City' : 'Add New City'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground mt-1">
                                    {editingCity ? 'Update city details and AMEEX mapping.' : 'Expand your service coverage by adding a new city.'}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="p-8 pt-0 space-y-6">
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2">
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">City Name</FormLabel>
                                            <FormControl>
                                                <Input placeholder="E.g. Casablanca" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="zone_id"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2">
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Assign to Zone</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner">
                                                        <SelectValue placeholder="Select a zone" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent className="rounded-2xl border-none shadow-xl">
                                                    {zones?.map((zone) => (
                                                        <SelectItem key={zone.id} value={zone.id} className="font-bold py-3 rounded-xl focus:bg-brand-navy focus:text-brand-white">
                                                            {zone.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="ameex_code"
                                    render={({ field }) => (
                                        <FormItem className="space-y-2">
                                            <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">AMEEX City Code</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="Enter code..."
                                                    {...field}
                                                    value={field.value || ''}
                                                    className="h-12 rounded-xl border-none bg-brand-navy/[0.04] text-base font-medium text-brand-navy shadow-inner focus-visible:ring-1 focus-visible:ring-brand-navy/10 px-4"
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            <DialogFooter className="p-8 pt-0">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => {
                                        setIsModalOpen(false);
                                        setEditingCity(null);
                                    }}
                                    className="rounded-xl h-12 px-6 font-bold hover:bg-muted"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="submit"
                                    disabled={addCityMutation.isPending || updateCityMutation.isPending}
                                    className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/20 transition-all active:scale-95"
                                >
                                    {(addCityMutation.isPending || updateCityMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                    {editingCity ? 'Update City' : 'Create City'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!cityToDelete} onOpenChange={() => setCityToDelete(null)}>
                <AlertDialogContent className="rounded-[40px] border-none p-8">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-2xl font-bold text-brand-navy">Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription className="text-base text-muted-foreground">
                            This will permanently delete <span className="font-black text-brand-navy">{cityToDelete?.name}</span>. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-6">
                        <AlertDialogCancel className="rounded-2xl h-12 px-6 font-bold border-none bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08]">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteCityMutation.mutate(cityToDelete.id)}
                            className="rounded-2xl h-12 px-8 font-bold bg-red-500 hover:bg-red-600 text-brand-white shadow-lg shadow-red-500/20"
                        >
                            {deleteCityMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            Delete City
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Cities;
