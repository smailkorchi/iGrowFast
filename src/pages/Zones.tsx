import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    Map,
    MoreVertical,
    Edit2,
    Trash2,
    MapPin,
    Calendar,
    Loader2,
    Check,
    X,
    Building2,
    ArrowRight
} from 'lucide-react';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
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
    FormMessage
} from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const zoneSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
});

type ZoneFormValues = z.infer<typeof zoneSchema>;

const Zones = () => {
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingZone, setEditingZone] = useState<any>(null);
    const [selectedZoneCities, setSelectedZoneCities] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const activeBusinessId = localStorage.getItem('activeBusinessId');

    // --- Queries ---
    const { data: zones, isLoading } = useQuery({
        queryKey: ['zones', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('zones')
                .select('*, master_cities(id)')
                .eq('DigiCom Business', activeBusinessId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const addZoneMutation = useMutation({
        mutationFn: async (values: ZoneFormValues) => {
            const { data, error } = await supabase
                .from('zones')
                .insert({
                    name: values.name,
                    'DigiCom Business': activeBusinessId
                })
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            setIsAddModalOpen(false);
            toast({ title: "Zone created", description: "The zone has been successfully created." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const updateZoneMutation = useMutation({
        mutationFn: async ({ id, values }: { id: string, values: ZoneFormValues }) => {
            const { data, error } = await supabase
                .from('zones')
                .update({
                    name: values.name,
                    'DigiCom Business': activeBusinessId
                })
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId)
                .select()
                .single();

            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            setEditingZone(null);
            toast({ title: "Zone updated", description: "The zone has been successfully updated." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    const deleteZoneMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from('zones')
                .delete()
                .eq('id', id)
                .eq('DigiCom Business', activeBusinessId);

            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['zones'] });
            toast({ title: "Zone deleted", description: "The zone has been successfully removed." });
        },
        onError: (error: any) => {
            toast({ title: "Error", description: error.message, variant: "destructive" });
        }
    });

    // --- Filter ---
    const filteredZones = zones?.filter(zone =>
        zone.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Geographic Zones</h1>
                            <p className="text-gray-500 font-light">Manage delivery zones and regional territories.</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <Button
                                onClick={() => setIsAddModalOpen(true)}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group"
                            >
                                <Plus className="w-5 h-5 mr-3 group-hover:rotate-90 transition-transform duration-500" />
                                Add New Zone
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <Card className="border-none shadow-sm bg-brand-white/50 backdrop-blur-sm rounded-[24px]">
                <CardContent className="p-4">
                    <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                        <Input
                            placeholder="Search by zone name..."
                            className="pl-12 bg-transparent border-none text-lg h-12 focus-visible:ring-0"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                        <Card key={i} className="h-[200px] animate-pulse bg-muted rounded-[32px] border-none" />
                    ))
                ) : filteredZones?.length === 0 ? (
                    <div className="col-span-full text-center py-20">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-4">
                            <MapPin className="w-10 h-10 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-bold">No zones found</h3>
                        <p className="text-muted-foreground">Try adjusting your search or add a new zone.</p>
                    </div>
                ) : (
                    filteredZones?.map((zone) => (
                        <ZoneCard
                            key={zone.id}
                            zone={zone}
                            onClick={() => setSelectedZoneCities(zone)}
                            onEdit={() => setEditingZone(zone)}
                            onDelete={() => {
                                if (confirm("Are you sure you want to delete this zone?")) {
                                    deleteZoneMutation.mutate(zone.id);
                                }
                            }}
                        />
                    ))
                )}
            </div>

            <ZoneCitiesModal
                zone={selectedZoneCities}
                isOpen={!!selectedZoneCities}
                onClose={() => setSelectedZoneCities(null)}
            />

            <ZoneModal
                isOpen={isAddModalOpen}
                onClose={() => setIsAddModalOpen(false)}
                onSubmit={(values) => addZoneMutation.mutate(values)}
                loading={addZoneMutation.isPending}
                title="Create New Zone"
            />

            {editingZone && (
                <ZoneModal
                    isOpen={!!editingZone}
                    onClose={() => setEditingZone(null)}
                    onSubmit={(values) => updateZoneMutation.mutate({ id: editingZone.id, values })}
                    initialData={editingZone}
                    loading={updateZoneMutation.isPending}
                    title="Edit Zone"
                />
            )}
        </div>
    );
};

const ZoneCard = ({ zone, onClick, onEdit, onDelete }: { zone: any, onClick: () => void, onEdit: () => void, onDelete: () => void }) => {
    return (
        <Card
            onClick={onClick}
            className="group relative cursor-pointer overflow-hidden border border-brand-white/10 bg-white/50 backdrop-blur-sm hover:shadow-2xl hover:shadow-brand-navy/5 transition-all duration-300 rounded-[32px] p-6 hover:-translate-y-1"
        >
            <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-brand-navy/[0.04] flex items-center justify-center text-brand-navy group-hover:bg-brand-navy group-hover:text-brand-white transition-all duration-500">
                    <Map className="w-6 h-6" />
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" className="h-10 w-10 rounded-full p-0 hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity">
                            <MoreVertical className="h-5 w-5 text-muted-foreground" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-xl">
                        <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer">
                            <Edit2 className="w-4 h-4 mr-3" />
                            Edit Zone
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer text-brand-red hover:bg-brand-red/5">
                            <Trash2 className="w-4 h-4 mr-3" />
                            Delete Zone
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="space-y-2">
                <h3 className="text-xl font-bold text-brand-navy group-hover:translate-x-1 transition-transform duration-300">
                    {zone.name}
                </h3>
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">
                        Added {zone.created_at ? format(new Date(zone.created_at), 'MMM dd, yyyy') : 'N/A'}
                    </span>
                </div>
            </div>

            <div className="mt-6 flex items-center justify-between">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-brand-navy/[0.04] text-brand-navy border border-brand-navy/[0.06]">
                    <Building2 className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold leading-none">{zone.master_cities?.length || 0} Cities</span>
                </div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-brand-navy/40 group-hover:text-brand-navy transition-colors">
                    Territory
                </div>
            </div>
        </Card>
    );
};

const ZoneModal = ({ isOpen, onClose, onSubmit, initialData, loading, title }: any) => {
    const form = useForm<ZoneFormValues>({
        resolver: zodResolver(zoneSchema),
        defaultValues: {
            name: '',
        }
    });

    React.useEffect(() => {
        if (isOpen) {
            if (initialData) {
                form.reset(initialData);
            } else {
                form.reset({ name: '' });
            }
        }
    }, [initialData, form, isOpen]);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-md p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <DialogHeader className="p-8 pb-4">
                            <DialogTitle className="text-2xl font-bold text-brand-navy">{title}</DialogTitle>
                            <DialogDescription className="text-muted-foreground mt-1">
                                Define geographical boundaries for this zone.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="p-8 pt-0 space-y-6">
                            <FormField
                                control={form.control}
                                name="name"
                                render={({ field }) => (
                                    <FormItem className="space-y-2">
                                        <FormLabel className="text-xs font-bold uppercase tracking-wider text-muted-foreground/70">Zone Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="E.g. Northern Region" {...field} className="h-14 rounded-2xl border-none bg-brand-navy/[0.04] text-base font-bold text-brand-navy shadow-inner" />
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
                                onClick={onClose}
                                className="rounded-xl h-12 px-6 font-bold hover:bg-muted"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={loading}
                                className="bg-brand-navy hover:bg-brand-navy/90 text-brand-white rounded-xl h-12 px-8 font-bold shadow-lg shadow-brand-navy/20 transition-all active:scale-95"
                            >
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                {initialData ? 'Save Changes' : 'Create Zone'}
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

const ZoneCitiesModal = ({ zone, isOpen, onClose }: { zone: any, isOpen: boolean, onClose: () => void }) => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [citySearch, setCitySearch] = useState("");
    const queryClient = useQueryClient();
    const { toast } = useToast();

    const { data: cities, isLoading } = useQuery({
        queryKey: ['cities-all', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('master_cities')
                .select('*')
                .eq('DigiCom Business', activeBusinessId)
                .order('name');
            if (error) throw error;
            return data;
        },
        enabled: isOpen
    });

    const updateCityZoneMutation = useMutation({
        mutationFn: async ({ cityId, zoneId }: { cityId: string, zoneId: string | null }) => {
            const { error } = await supabase
                .from('master_cities')
                .update({ zone_id: zoneId })
                .eq('id', cityId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['cities-all'] });
            toast({ title: "Updated", description: "City association updated successfully." });
        }
    });

    const currentZoneCities = cities?.filter(c => c.zone_id === zone?.id) || [];
    const availableCities = cities?.filter(c => c.zone_id === null) || [];

    const filteredCurrent = currentZoneCities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));
    const filteredAvailable = availableCities.filter(c => c.name.toLowerCase().includes(citySearch.toLowerCase()));

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-2xl p-0 border-none bg-brand-white rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <DialogHeader className="p-8 pb-4 shrink-0">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-brand-navy flex items-center justify-center text-brand-white shadow-lg shadow-brand-navy/20">
                            <Building2 className="w-5 h-5" />
                        </div>
                        <div>
                            <DialogTitle className="text-2xl font-bold text-brand-navy">{zone?.name}</DialogTitle>
                            <DialogDescription>Manage cities covered by this hub</DialogDescription>
                        </div>
                    </div>
                    <div className="relative mt-4">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search cities..."
                            value={citySearch}
                            onChange={(e) => setCitySearch(e.target.value)}
                            className="pl-11 h-12 bg-brand-navy/[0.04] border-none rounded-2xl focus-visible:ring-1 focus-visible:ring-brand-navy/20 transition-all font-medium"
                        />
                    </div>
                </DialogHeader>

                <div className="overflow-y-auto p-8 pt-4 space-y-8 flex-1">
                    {/* Current Cities */}
                    <div className="space-y-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 px-2">
                            Assigned to this zone ({currentZoneCities.length})
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {filteredCurrent.length > 0 ? filteredCurrent.map(city => (
                                <div key={city.id} className="group/item flex items-center justify-between p-4 rounded-2xl bg-brand-navy/[0.03] border border-transparent hover:border-brand-navy/10 transition-all">
                                    <span className="font-bold text-brand-navy">{city.name}</span>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: null })}
                                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50"
                                    >
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            )) : (
                                <p className="text-sm text-muted-foreground px-2 pt-2 italic">No cities assigned yet.</p>
                            )}
                        </div>
                    </div>

                    {/* Available Cities */}
                    <div className="space-y-4 pt-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40 px-2">
                            Available Cities (Unassigned)
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {filteredAvailable.length > 0 ? filteredAvailable.map(city => (
                                <div key={city.id} className="group/item flex items-center justify-between p-4 rounded-2xl bg-brand-white border border-brand-navy/[0.06] hover:border-brand-navy/20 transition-all">
                                    <span className="font-bold text-brand-navy/70">{city.name}</span>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => updateCityZoneMutation.mutate({ cityId: city.id, zoneId: zone.id })}
                                        className="h-8 w-8 rounded-lg text-muted-foreground hover:text-green-600 hover:bg-green-50"
                                    >
                                        <Plus className="w-4 h-4" />
                                    </Button>
                                </div>
                            )) : (
                                <p className="text-sm text-muted-foreground px-2 pt-2 italic">No unassigned cities available.</p>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-8 pb-10 border-t border-brand-navy/[0.04] shrink-0 bg-brand-white">
                    <Button onClick={onClose} variant="ghost" className="w-full h-12 rounded-2xl font-bold bg-brand-navy/[0.04] hover:bg-brand-navy/[0.08] text-brand-navy transition-all">
                        Close Management
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default Zones;
