import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Building2,
    Plus,
    ArrowRight,
    Loader2,
    ShieldCheck,
    LogOut,
    Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { AddEditBusinessModal, BusinessFormValues } from '@/components/businesses/AddEditBusinessModal';

// Slim businesses row used for the entity picker (full schema verified via MCP).
type SimpleBusinessRow = { id: string; name: string; logo: string | null };

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

const SelectBusiness = () => {
    const navigate = useNavigate();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [searchQuery, setSearchQuery] = useState("");
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);

    const { data: businesses, isLoading } = useQuery({
        queryKey: ['businesses'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('businesses')
                .select('*')
                .eq('active', true)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data || []) as unknown as SimpleBusinessRow[];
        },
    });

    const upsertMutation = useMutation({
        mutationFn: async (payload: BusinessFormValues & { id?: string }) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { id, ...values } = payload;
            const dataToSubmit = {
                ...values,
                creator_id: user.id,
                updated_at: new Date().toISOString(),
            };

            if (id) {
                // Generated Update type rejects partial column sets even though zod validates name/plan_id.
                const { error } = await supabase.from('businesses').update(dataToSubmit as unknown as never).eq('id', id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('businesses').insert([dataToSubmit as unknown as never]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['businesses'] });
            setIsAddEditModalOpen(false);
            toast({ title: "Success", description: "Business environment registered." });
        },
        onError: (err) => {
            toast({ title: "Registration Failed", description: errorMessage(err), variant: "destructive" });
        }
    });

    const handleSelect = async (business: SimpleBusinessRow) => {
        // Update owner's active business in DB so all RLS policies resolve correctly
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            await supabase
                .from('users')
                .update({ 'DigiCom Business': business.id })
                .eq('id', user.id);
        }
        const url = `${window.location.origin}/?businessId=${business.id}`;
        window.open(url, '_blank');
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('activeBusinessId');
        navigate('/auth');
    };

    const filteredBusinesses = businesses?.filter(b =>
        b.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-brand-navy flex flex-col font-sans">
            {/* Header */}
            <header className="flex justify-between items-center px-5 py-4 border-b border-white/5">
                <div className="flex items-center gap-2.5">
                    <ShieldCheck className="w-4 h-4 text-white/50" />
                    <div>
                        <p className="text-[13px] font-semibold text-white tracking-tight leading-none">Gateway</p>
                        <p className="text-[9px] text-white/30 uppercase tracking-[0.18em] mt-0.5">Secure Infrastructure</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <div className="hidden md:flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[9px] text-white/40 uppercase tracking-[0.18em]">Live session</span>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="h-8 px-3 rounded-md text-[11px] font-semibold text-white/40 hover:text-red-400 hover:bg-white/5 transition-colors flex items-center gap-1.5"
                    >
                        <LogOut className="w-3.5 h-3.5" />
                        Logout
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 flex flex-col items-center justify-center px-5 py-10">
                <div className="w-full max-w-4xl space-y-6">
                    {/* Title */}
                    <div>
                        <h1 className="text-[15px] font-semibold text-white tracking-tight leading-none">Select Entity</h1>
                        <p className="text-[9px] text-white/30 uppercase tracking-[0.18em] mt-1">Choose the organization to manage for this session</p>
                    </div>

                    {/* Search & Actions */}
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
                            <Input
                                placeholder="Search entities..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-8 bg-white/5 border-white/10 rounded-md pl-8 text-[11px] text-white placeholder:text-white/30 focus:bg-white/8 focus:border-white/20"
                            />
                        </div>
                        <Button
                            onClick={() => setIsAddEditModalOpen(true)}
                            className="h-8 rounded-md text-[11px] font-semibold bg-white text-brand-navy hover:bg-white/90 gap-1.5 px-3 shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Register New
                        </Button>
                    </div>

                    {/* Cards Grid */}
                    {isLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-32 rounded-xl bg-white/5 animate-pulse border border-white/5" />
                            ))}
                        </div>
                    ) : filteredBusinesses?.length === 0 ? (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-10 text-center">
                            <Building2 className="w-5 h-5 text-white/20 mx-auto mb-3" />
                            <p className="text-[12px] font-semibold text-white/60">No entities found</p>
                            <p className="text-[10px] text-white/30 mt-1">Register a business unit to begin.</p>
                            <Button
                                onClick={() => setIsAddEditModalOpen(true)}
                                className="mt-4 h-8 rounded-md text-[11px] font-semibold bg-white text-brand-navy hover:bg-white/90 gap-1.5 px-3"
                            >
                                Register First Entity
                            </Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {filteredBusinesses?.map((business) => {
                                const name = business.name || '';
                                const isLongName = name.length > 28;
                                const isVeryLongName = name.length > 60;
                                return (
                                    <div
                                        key={business.id}
                                        onClick={() => handleSelect(business)}
                                        title={name}
                                        className="group rounded-xl border border-white/10 bg-white/5 hover:bg-white/8 p-3.5 cursor-pointer transition-colors flex flex-col gap-3"
                                    >
                                        {/* Header */}
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="w-10 h-10 rounded-md bg-white p-1.5 shrink-0">
                                                {business.logo ? (
                                                    <img src={business.logo} alt="" className="w-full h-full object-contain" />
                                                ) : (
                                                    <Building2 className="w-full h-full text-brand-navy/30" />
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                                                <div className="w-1 h-1 rounded-full bg-emerald-500" />
                                                <span className="text-[8px] text-emerald-400 font-semibold uppercase tracking-[0.15em]">Active</span>
                                            </div>
                                        </div>

                                        {/* Name */}
                                        <p
                                            className={cn(
                                                "font-semibold text-white leading-tight break-words line-clamp-3",
                                                isVeryLongName ? "text-[11px]" : isLongName ? "text-[13px]" : "text-[15px]"
                                            )}
                                        >
                                            {name}
                                        </p>

                                        {/* Footer */}
                                        <div className="flex items-center justify-between border-t border-white/5 pt-2.5 mt-auto">
                                            <div>
                                                <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-white/20">Entity ID</p>
                                                <p className="text-[9px] font-semibold text-white/40 tabular-nums mt-0.5">#{business.id.substring(0, 8).toUpperCase()}</p>
                                            </div>
                                            <div className="w-7 h-7 rounded-md bg-white/5 group-hover:bg-white group-hover:text-brand-navy flex items-center justify-center text-white/30 transition-colors shrink-0">
                                                <ArrowRight className="w-3.5 h-3.5" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>

            {/* Add/Edit Modal */}
            <AddEditBusinessModal
                isOpen={isAddEditModalOpen}
                onClose={() => setIsAddEditModalOpen(false)}
                onSubmit={(values) => upsertMutation.mutate(values)}
                loading={upsertMutation.isPending}
            />
        </div>
    );
};

export default SelectBusiness;
