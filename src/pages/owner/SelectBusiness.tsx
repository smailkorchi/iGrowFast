import React, { useEffect, useState } from 'react';
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
        <div className="min-h-screen bg-brand-navy flex flex-col relative overflow-hidden font-sans">
            {/* Dynamic Background Elements */}
            <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-500/10 rounded-full blur-[120px] animate-pulse" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/10 rounded-full blur-[100px] animate-pulse delay-700" />
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] pointer-events-none" />

            {/* Header */}
            <header className="relative z-20 flex justify-between items-center p-8 md:p-12">
                <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-white/5 rounded-2xl border border-white/10 flex items-center justify-center backdrop-blur-md shadow-2xl">
                        <ShieldCheck className="w-6 h-6 text-brand-white" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-brand-white tracking-tighter uppercase">Gateway</h1>
                        <p className="text-[10px] text-white/30 font-bold uppercase tracking-[0.3em]">Secure Infrastructure</p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="hidden md:flex flex-col items-end">
                        <span className="text-[10px] text-white/20 font-black uppercase tracking-widest">Authenticated session</span>
                        <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            <span className="text-xs font-bold text-white/60">Live Environment</span>
                        </div>
                    </div>
                    <button
                        onClick={handleLogout}
                        className="p-3 bg-white/5 hover:bg-red-500/10 text-white/20 hover:text-red-400 rounded-2xl transition-all duration-300 group"
                    >
                        <LogOut className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
            </header>

            {/* Main Content */}
            <main className="flex-1 relative z-20 flex flex-col items-center justify-center px-6 pb-20">
                <div className="w-full max-w-4xl space-y-12">
                    {/* Welcome Text */}
                    <div className="text-center space-y-4 animate-in fade-in slide-in-from-bottom-8 duration-700">
                        <h2 className="text-5xl md:text-7xl font-black text-brand-white tracking-[1.5%] leading-tight">
                            SELECT YOUR <br />
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-white via-white/40 to-white/10">ENTITY.</span>
                        </h2>
                        <p className="text-white/40 text-sm md:text-base font-medium max-w-lg mx-auto uppercase tracking-wider">
                            Choose the organization you wish to manage for this session.
                        </p>
                    </div>

                    {/* Search & Actions */}
                    <div className="flex flex-col md:flex-row gap-4 animate-in fade-in slide-in-from-bottom-12 duration-700 delay-200">
                        <div className="relative flex-1 group">
                            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-white/60 transition-colors" />
                            <Input
                                placeholder="Locate entity..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="h-16 bg-white/[0.03] border-white/5 rounded-[24px] pl-14 text-brand-white font-bold text-lg focus:bg-white/[0.05] focus:border-white/10 transition-all shadow-2xl backdrop-blur-md"
                            />
                        </div>
                        <Button
                            onClick={() => setIsAddEditModalOpen(true)}
                            className="h-16 px-8 bg-brand-white hover:bg-white/90 text-brand-navy rounded-[24px] font-black text-lg gap-3 transition-all hover:scale-[1.02] active:scale-[0.98] shadow-[0_20px_40px_-10px_rgba(255,255,255,0.2)]"
                        >
                            <Plus className="w-5 h-5" />
                            Register New
                        </Button>
                    </div>

                    {/* Cards Grid */}
                    {isLoading ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-1000">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-64 rounded-[40px] bg-white/[0.02] animate-pulse border border-white/5" />
                            ))}
                        </div>
                    ) : filteredBusinesses?.length === 0 ? (
                        <div className="py-20 text-center space-y-6 bg-white/[0.02] rounded-[48px] border border-white/5 backdrop-blur-sm animate-in zoom-in-95 duration-700">
                            <div className="w-20 h-20 bg-white/5 rounded-[32px] flex items-center justify-center mx-auto text-white/10">
                                <Building2 className="w-10 h-10" />
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-2xl font-black text-brand-white tracking-tight uppercase">No Entities Found</h3>
                                <p className="text-white/30 text-sm font-medium">Create a business unit to unlock your dashboard.</p>
                                <Button
                                    onClick={() => setIsAddEditModalOpen(true)}
                                    className="mt-4 bg-brand-white text-brand-navy hover:bg-white/90 rounded-2xl h-12 px-6 font-black uppercase text-xs tracking-widest"
                                >
                                    Register First Entity
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 auto-rows-fr">
                            {filteredBusinesses?.map((business, index) => {
                                const name = business.name || '';
                                const isLongName = name.length > 28;
                                const isVeryLongName = name.length > 60;
                                return (
                                <div
                                    key={business.id}
                                    onClick={() => handleSelect(business)}
                                    title={name}
                                    className={cn(
                                        "group relative h-full min-h-[340px] bg-white/[0.02] hover:bg-white/[0.05] border border-white/5 rounded-[40px] p-7 cursor-pointer transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-2 hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.4)] flex flex-col overflow-hidden backdrop-blur-md animate-in fade-in slide-in-from-bottom-12",
                                    )}
                                    style={{ animationDelay: `${index * 100}ms` }}
                                >
                                    {/* Hover Glow Effect */}
                                    <div className="absolute inset-0 bg-gradient-to-b from-white/[0.05] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />

                                    {/* Header: logo + status */}
                                    <div className="relative z-10 flex items-start justify-between gap-4">
                                        <div className="w-16 h-16 rounded-[22px] bg-white p-3 shadow-2xl group-hover:scale-110 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] shrink-0">
                                            {business.logo ? (
                                                <img src={business.logo} alt="" className="w-full h-full object-contain" />
                                            ) : (
                                                <Building2 className="w-full h-full text-brand-navy/20" />
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                                            <span className="text-[9px] text-emerald-300/80 font-black uppercase tracking-widest">Active</span>
                                        </div>
                                    </div>

                                    {/* Title block, grows to fill */}
                                    <div className="relative z-10 mt-6 flex-1 min-h-0">
                                        <h3
                                            className={cn(
                                                "font-black text-brand-white tracking-tight leading-[1.05] uppercase break-words hyphens-auto line-clamp-4",
                                                isVeryLongName ? "text-base" : isLongName ? "text-xl" : "text-2xl md:text-[26px]"
                                            )}
                                            style={{ wordBreak: 'break-word' }}
                                        >
                                            {name}
                                        </h3>
                                    </div>

                                    {/* Footer pinned */}
                                    <div className="relative z-10 mt-6 pt-5 border-t border-white/5 flex items-center justify-between gap-3">
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[8px] font-black uppercase tracking-[0.3em] text-white/20 mb-1">Entity ID</span>
                                            <span className="text-[10px] font-bold text-white/40 tracking-wider truncate">#{business.id.substring(0, 8).toUpperCase()}</span>
                                        </div>

                                        <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-white/20 group-hover:bg-brand-white group-hover:text-brand-navy transition-all duration-500 shadow-xl shrink-0">
                                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                                        </div>
                                    </div>

                                    {/* Subtle Animated Border on Hover */}
                                    <div className="absolute inset-0 border-2 border-white/0 group-hover:border-white/10 rounded-[40px] transition-all duration-700 pointer-events-none" />
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

            {/* Footer Background Decoration */}
            <div className="absolute bottom-0 left-0 right-0 h-64 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
        </div>
    );
};

export default SelectBusiness;
