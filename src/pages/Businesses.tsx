import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Plus,
    Search,
    MoreVertical,
    Edit2,
    Trash2,
    Loader2,
    Building2,
    LayoutGrid,
    List,
    AlertTriangle,
    CheckCircle2,
    Upload,
    X,
    User,
    Shield,
    Image as ImageIcon
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useDropzone } from 'react-dropzone';

import { AddEditBusinessModal, BusinessFormValues } from '@/components/businesses/AddEditBusinessModal';

const Businesses = () => {
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState("");
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedBusiness, setSelectedBusiness] = useState<any>(null);

    // Delete confirmation states
    const [deleteStep, setDeleteStep] = useState(1);
    const [confirmName, setConfirmName] = useState("");
    const [confirmDeleteText, setConfirmDeleteText] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    // --- Queries ---
    const { data: businesses, isLoading } = useQuery({
        queryKey: ['businesses'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('businesses')
                .select(`
                    *,
                    creator:users!businesses_creator_id_fkey(id, name, avatar_url, role)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return data;
        },
    });

    const filteredBusinesses = useMemo(() => {
        if (!businesses) return [];
        return businesses.filter(b =>
            b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.creator?.name?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [businesses, searchQuery]);

    // --- Mutations ---
    const upsertMutation = useMutation({
        mutationFn: async (payload: BusinessFormValues & { id?: string }) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { id, ...values } = payload;
            const dataToSubmit = {
                ...values,
                creator_id: user.id,
                updated_at: new Date().toISOString()
            };

            if (id) {
                const { error } = await supabase.from('businesses').update(dataToSubmit).eq('id', id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('businesses').insert([dataToSubmit]);
                if (error) throw error;
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['businesses'] });
            setIsAddEditModalOpen(false);
            setSelectedBusiness(null);
            toast({ title: "Success", description: "Business information updated." });
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('businesses').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['businesses'] });
            setIsDeleteModalOpen(false);
            setDeleteStep(1);
            setConfirmName("");
            setConfirmDeleteText("");
            toast({ title: "Deleted", description: "Business has been wiped from the system." });
        },
        onError: (err: any) => {
            toast({ title: "Deletion Failed", description: err.message, variant: "destructive" });
        }
    });

    const handleEdit = (business: any) => {
        setSelectedBusiness(business);
        setIsAddEditModalOpen(true);
    };

    const handleDeleteClick = (business: any) => {
        setSelectedBusiness(business);
        setDeleteStep(1);
        setConfirmName("");
        setConfirmDeleteText("");
        setIsDeleteModalOpen(true);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Business Units</h1>
                            <p className="text-gray-500 font-light">Manage corporate identities and regional branches.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search businesses..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                onClick={() => {
                                    setSelectedBusiness(null);
                                    setIsAddEditModalOpen(true);
                                }}
                                className="bg-primary hover:bg-primary/90 text-white shadow-xl shadow-primary/20 h-12 px-6 rounded-2xl transition-all duration-300 active:scale-95 group flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Plus className="w-5 h-5" />
                                New Business
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* View Toggle */}
            <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-brand-navy/5 w-fit">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('grid')}
                    className={cn(
                        "h-9 px-4 rounded-lg gap-2 transition-all font-bold",
                        viewMode === 'grid' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40"
                    )}
                >
                    <LayoutGrid className="w-4 h-4" /> Grid
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setViewMode('list')}
                    className={cn(
                        "h-9 px-4 rounded-lg gap-2 transition-all font-bold",
                        viewMode === 'list' ? "bg-brand-navy text-white shadow-lg" : "text-brand-navy/40"
                    )}
                >
                    <List className="w-4 h-4" /> List
                </Button>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-64 rounded-[32px] w-full" />)}
                </div>
            ) : filteredBusinesses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 space-y-6 bg-white/40 backdrop-blur-md rounded-[40px] border border-brand-navy/[0.03]">
                    <div className="w-24 h-24 bg-brand-navy/[0.04] rounded-[32px] flex items-center justify-center text-brand-navy/20">
                        <Building2 className="w-12 h-12" />
                    </div>
                    <div className="text-center space-y-2">
                        <h3 className="text-2xl font-black text-brand-navy uppercase tracking-tight">No Businesses</h3>
                        <p className="text-muted-foreground max-w-xs mx-auto font-medium">Create your first business unit to start organizing your operations.</p>
                    </div>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
                    {filteredBusinesses.map(business => (
                        <BusinessCard
                            key={business.id}
                            business={business}
                            onEdit={() => handleEdit(business)}
                            onDelete={() => handleDeleteClick(business)}
                        />
                    ))}
                </div>
            ) : (
                <div className="space-y-4 pb-20">
                    {filteredBusinesses.map(business => (
                        <BusinessListItem
                            key={business.id}
                            business={business}
                            onEdit={() => handleEdit(business)}
                            onDelete={() => handleDeleteClick(business)}
                        />
                    ))}
                </div>
            )}

            {/* Add/Edit Modal */}
            <AddEditBusinessModal
                isOpen={isAddEditModalOpen}
                onClose={() => setIsAddEditModalOpen(false)}
                onSubmit={(values) => upsertMutation.mutate({ ...values, id: selectedBusiness?.id })}
                initialData={selectedBusiness}
                loading={upsertMutation.isPending}
            />

            {/* Delete Dialog */}
            <DeleteConfirmationDialog
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                business={selectedBusiness}
                onConfirm={() => deleteMutation.mutate(selectedBusiness.id)}
                loading={deleteMutation.isPending}
                step={deleteStep}
                setStep={setDeleteStep}
                confirmName={confirmName}
                setConfirmName={setConfirmName}
                confirmDeleteText={confirmDeleteText}
                setConfirmDeleteText={setConfirmDeleteText}
            />
        </div>
    );
};

// --- Sub-components ---

const BusinessCard = ({ business, onEdit, onDelete }: any) => (
    <Card className="group relative overflow-hidden border-none bg-white/60 backdrop-blur-md shadow-sm hover:shadow-[0_32px_64px_-16px_rgba(0,31,63,0.18)] hover:-translate-y-2 transition-all duration-700 rounded-[40px] border border-white/20 cursor-default">
        {/* Animated Background Glow */}
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-brand-navy/[0.03] rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />

        {/* Top Accent Bar */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-brand-navy/5 group-hover:bg-brand-navy transition-all duration-500" />

        <CardContent className="p-8 space-y-7 relative z-10">
            <div className="flex items-start justify-between">
                <div className="w-20 h-20 rounded-[28px] bg-white border border-brand-navy/5 flex items-center justify-center overflow-hidden shadow-sm group-hover:shadow-xl group-hover:scale-105 transition-all duration-700 shrink-0">
                    {business.logo ? (
                        <img src={business.logo} alt="" className="w-full h-full object-contain p-3" />
                    ) : (
                        <Building2 className="w-10 h-10 text-brand-navy/10" />
                    )}
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl hover:bg-brand-navy/5 text-brand-navy/20 hover:text-brand-navy transition-colors">
                            <MoreVertical className="h-5 w-5" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-2xl border-none shadow-2xl p-2 bg-brand-white animate-in zoom-in-95">
                        <DropdownMenuItem onClick={onEdit} className="rounded-xl p-3 cursor-pointer focus:bg-brand-navy focus:text-brand-white gap-3 font-bold uppercase text-[10px] tracking-widest leading-none transition-colors">
                            <Edit2 className="w-4 h-4" /> Modify
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-brand-navy/5" />
                        <DropdownMenuItem onClick={onDelete} className="rounded-xl p-3 cursor-pointer text-red-500 focus:bg-red-50 focus:text-red-600 gap-3 font-bold uppercase text-[10px] tracking-widest leading-none transition-colors">
                            <Trash2 className="w-4 h-4" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div className="space-y-1">
                <h3 className="text-2xl font-black text-brand-navy tracking-tight uppercase leading-none transition-colors">
                    {business.name}
                </h3>
                <div className="flex items-center gap-2">
                    <Badge className={cn(
                        "border-none font-bold text-[8px] uppercase tracking-[0.2em] px-2 py-0.5 rounded-md",
                        business.active ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
                    )}>
                        {business.active ? 'Operational' : 'Offline'}
                    </Badge>
                </div>
            </div>

            <div className="pt-4 border-t border-brand-navy/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border-2 border-white shadow-sm ring-1 ring-brand-navy/5">
                        <AvatarImage src={business.creator?.avatar_url} />
                        <AvatarFallback className="bg-brand-navy text-white text-[10px] font-black uppercase">
                            {business.creator?.name?.substring(0, 2) || '??'}
                        </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-brand-navy/40">Responsible</span>
                        <span className="text-xs font-bold text-brand-navy">{business.creator?.name || 'N/A'}</span>
                    </div>
                </div>
                <Badge variant="outline" className="text-[8px] font-black uppercase tracking-tighter bg-brand-navy/5 border-none text-brand-navy/30">
                    {business.creator?.role || 'Admin'}
                </Badge>
            </div>
        </CardContent>
    </Card>
);

const BusinessListItem = ({ business, onEdit, onDelete }: any) => (
    <div className="group bg-white/60 hover:bg-white backdrop-blur-md border border-brand-navy/[0.03] rounded-2xl p-4 flex items-center justify-between transition-all duration-300 hover:shadow-lg">
        <div className="flex items-center gap-6">
            <div className="w-12 h-12 rounded-xl bg-brand-navy/5 border border-brand-navy/5 flex items-center justify-center overflow-hidden shrink-0">
                {business.logo ? (
                    <img src={business.logo} alt="" className="w-full h-full object-contain p-1.5" />
                ) : (
                    <Building2 className="w-6 h-6 text-brand-navy/20" />
                )}
            </div>
            <div className="space-y-0.5">
                <h4 className="text-lg font-black text-brand-navy uppercase tracking-tight">{business.name}</h4>
                <div className="flex items-center gap-2">
                    <div className={cn("w-1.5 h-1.5 rounded-full", business.active ? "bg-emerald-500" : "bg-slate-300")} />
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                        {business.active ? 'Active' : 'Inactive'}
                    </span>
                </div>
            </div>
        </div>

        <div className="flex items-center gap-12">
            <div className="hidden md:flex items-center gap-3">
                <Avatar className="h-8 w-8">
                    <AvatarImage src={business.creator?.avatar_url} />
                    <AvatarFallback className="text-[8px]">{business.creator?.name?.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-widest text-brand-navy/40">Managed By</span>
                    <span className="text-[11px] font-bold text-brand-navy">{business.creator?.name}</span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" onClick={onEdit} className="h-10 w-10 rounded-xl hover:bg-brand-navy/5 text-brand-navy/40">
                    <Edit2 className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onDelete} className="h-10 w-10 rounded-xl hover:bg-red-50 text-red-400">
                    <Trash2 className="w-4 h-4" />
                </Button>
            </div>
        </div>
    </div>
);



const DeleteConfirmationDialog = ({
    isOpen,
    onClose,
    business,
    onConfirm,
    loading,
    step,
    setStep,
    confirmName,
    setConfirmName,
    confirmDeleteText,
    setConfirmDeleteText
}: any) => {
    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-xl p-0 border-none bg-white rounded-[40px] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.25)] overflow-hidden animate-in zoom-in-95 duration-500">
                {/* Clean Header */}
                <div className="p-10 pb-4 space-y-6">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 shadow-sm border border-red-100/50">
                            <AlertTriangle className="w-7 h-7" />
                        </div>
                        <div className="space-y-1">
                            <DialogTitle className="text-3xl font-black uppercase tracking-tight text-brand-navy">
                                System Wipe
                            </DialogTitle>
                            <DialogDescription className="text-brand-navy/30 font-bold uppercase text-[10px] tracking-[0.2em]">
                                Irreversible Action Required
                            </DialogDescription>
                        </div>
                    </div>

                    <div className="p-6 rounded-[24px] bg-slate-50/50 border border-slate-100 space-y-3">
                        <p className="text-slate-600 font-medium text-base leading-relaxed">
                            You are about to permanently delete <span className="font-black text-brand-navy uppercase italic">"{business?.name}"</span>.
                            This action will wipe all associated records from the infrastructure.
                        </p>
                    </div>
                </div>

                <div className="px-10 pb-10 space-y-8">
                    {/* Step Progress */}
                    <div className="flex items-center gap-2">
                        <div className={cn("h-1.5 flex-1 rounded-full transition-all duration-500", step >= 1 ? "bg-red-500" : "bg-slate-100")} />
                        <div className={cn("h-1.5 flex-1 rounded-full transition-all duration-500", step >= 2 ? "bg-red-500" : "bg-slate-100")} />
                    </div>

                    <div className="space-y-6 min-h-[160px] flex flex-col justify-center">
                        {step === 1 ? (
                            <div className="space-y-5 animate-in slide-in-from-right-8 duration-500">
                                <div className="space-y-3">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-navy/40 pl-1">
                                        Verify Entity Name
                                    </label>
                                    <Input
                                        placeholder={`Type "${business?.name}"`}
                                        value={confirmName}
                                        onChange={(e) => setConfirmName(e.target.value)}
                                        className="h-16 rounded-2xl border-none bg-slate-50 font-bold text-lg text-brand-navy shadow-inner px-6 focus-visible:ring-1 focus-visible:ring-brand-navy/10 transition-all font-medium"
                                    />
                                </div>
                                <Button
                                    onClick={() => setStep(2)}
                                    disabled={confirmName !== business?.name}
                                    className="w-full h-16 rounded-2xl bg-brand-navy text-white font-black text-lg shadow-xl shadow-brand-navy/10 transition-all hover:translate-y-[-2px] active:scale-95 disabled:opacity-20 flex items-center justify-center gap-2"
                                >
                                    Confirm Entity
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-5 animate-in slide-in-from-left-8 duration-500">
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between px-1">
                                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-red-500/60 font-black">
                                            Final Authorization
                                        </label>
                                        <button onClick={() => setStep(1)} className="text-[10px] font-black text-slate-400 uppercase hover:text-brand-navy transition-colors">Go Back</button>
                                    </div>
                                    <Input
                                        placeholder='Type "DELETE"'
                                        value={confirmDeleteText}
                                        onChange={(e) => setConfirmDeleteText(e.target.value)}
                                        className="h-16 rounded-2xl border-none bg-red-50/30 font-bold text-lg text-red-600 shadow-inner px-6 focus-visible:ring-1 focus-visible:ring-red-200 transition-all font-medium"
                                    />
                                </div>
                                <Button
                                    onClick={onConfirm}
                                    disabled={confirmDeleteText !== "DELETE" || loading}
                                    className="w-full h-16 rounded-2xl bg-red-500 hover:bg-red-600 text-white font-black text-lg shadow-2xl shadow-red-500/20 transition-all hover:translate-y-[-2px] active:scale-95 disabled:opacity-20 flex items-center justify-center gap-3"
                                >
                                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Trash2 className="w-6 h-6" />}
                                    Execute Permanent Wipe
                                </Button>
                            </div>
                        )}
                    </div>

                    <div className="flex justify-center pt-2">
                        <button
                            onClick={onClose}
                            className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 hover:text-brand-navy transition-colors flex items-center gap-2 group"
                        >
                            <X className="w-3 h-3 group-hover:rotate-90 transition-transform" />
                            Abort Sequence
                        </button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default Businesses;
