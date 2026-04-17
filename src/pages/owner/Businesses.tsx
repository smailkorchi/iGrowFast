import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
    Upload,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useDropzone } from 'react-dropzone';
import { Switch } from '@/components/ui/switch';

import { AddEditBusinessModal, BusinessFormValues } from '@/components/businesses/AddEditBusinessModal';

// businesses row shape verified via MCP, joined with creator (users) and plan (plans).
type BusinessRow = {
    id: string;
    name: string;
    logo: string | null;
    creator_id: string | null;
    active: boolean | null;
    created_at: string | null;
    updated_at: string | null;
    license_type: string;
    license_start: string;
    license_end: string | null;
    status: string;
    paid: boolean;
    plan_id: string | null;
    creator: { id: string; name: string | null; avatar_url: string | null; role: string | null } | null;
    plan: { id: string; name: string; license_type: string; price: number; currency: string | null } | null;
};

type BusinessUpdateFields = {
    name?: string;
    active?: boolean;
    logo?: string | null;
    plan_id?: string;
    license_type?: string;
    license_start?: string;
    license_end?: string | null;
    status?: string;
    paid?: boolean;
    creator_id?: string;
    updated_at?: string;
};

const errorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (err && typeof err === 'object') {
        const e = err as { message?: unknown; details?: unknown; hint?: unknown };
        if (typeof e.message === 'string' && e.message) return e.message;
        if (typeof e.details === 'string' && e.details) return e.details;
        if (typeof e.hint === 'string' && e.hint) return e.hint;
    }
    return String(err);
};

const adminUserSchema = z.object({
    name: z.string().min(2, 'Name is required'),
    username: z.string().min(3, 'Username is required'),
    email: z.string().email('Invalid email'),
    password: z.string().min(6, 'Min 6 characters'),
    active: z.boolean().default(true),
    avatar_url: z.string().optional().nullable(),
});

const LICENSE_DURATIONS: Record<string, number> = {
    monthly: 30,
    yearly: 365,
};

const STATUS_DOT: Record<string, string> = {
    active: 'bg-emerald-500',
    suspended: 'bg-amber-500',
    deactivated: 'bg-red-500',
};

function computeLicenseEnd(type: string, from?: Date): string | null {
    if (type === 'lifetime') return null;
    const start = from || new Date();
    const days = LICENSE_DURATIONS[type] || 30;
    return new Date(start.getTime() + days * 86400000).toISOString();
}

async function fetchPlanById(planId: string) {
    const { data } = await supabase.from('plans').select('*').eq('id', planId).single();
    return data;
}

const Businesses = () => {
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState("");
    const [isAddEditModalOpen, setIsAddEditModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedBusiness, setSelectedBusiness] = useState<BusinessRow | null>(null);
    const [isCreateAdminOpen, setIsCreateAdminOpen] = useState(false);
    const [newBusinessId, setNewBusinessId] = useState<string | null>(null);

    const [deleteStep, setDeleteStep] = useState(1);
    const [confirmName, setConfirmName] = useState("");
    const [confirmDeleteText, setConfirmDeleteText] = useState("");

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: businesses, isLoading } = useQuery({
        queryKey: ['businesses'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('businesses')
                .select(`
                    *,
                    creator:users!businesses_creator_id_fkey(id, name, avatar_url, role),
                    plan:plans(id, name, license_type, price, currency)
                `)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return (data || []) as unknown as BusinessRow[];
        },
    });

    const filteredBusinesses = useMemo(() => {
        if (!businesses) return [];
        return businesses.filter(b =>
            b.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.creator?.name?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [businesses, searchQuery]);

    const upsertMutation = useMutation({
        mutationFn: async (payload: BusinessFormValues & { id?: string }) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { id, status, ...values } = payload;
            const now = new Date();

            const plan = await fetchPlanById(values.plan_id);
            if (!plan) throw new Error("Selected plan not found");

            const dataToSubmit: BusinessUpdateFields = {
                name: values.name,
                active: values.active,
                logo: values.logo,
                plan_id: values.plan_id,
                license_type: plan.license_type,
                updated_at: now.toISOString(),
            };

            if (id) {
                const { data: existing } = await supabase
                    .from('businesses')
                    .select('plan_id, license_type, status')
                    .eq('id', id)
                    .single();

                const planChanged = existing && existing.plan_id !== values.plan_id;

                if (planChanged) {
                    dataToSubmit.license_start = now.toISOString();
                    dataToSubmit.license_end = computeLicenseEnd(plan.license_type, now);
                    dataToSubmit.paid = true;
                    if (existing.status === 'suspended' || existing.status === 'deactivated') {
                        dataToSubmit.status = 'active';
                        dataToSubmit.active = true;
                    }
                }

                const { error } = await supabase.from('businesses').update(dataToSubmit).eq('id', id);
                if (error) throw error;
                return { isNew: false };
            } else {
                dataToSubmit.creator_id = user.id;
                dataToSubmit.license_start = now.toISOString();
                dataToSubmit.license_end = computeLicenseEnd(plan.license_type, now);
                dataToSubmit.status = 'active';
                dataToSubmit.paid = true;
                // dataToSubmit is built conditionally above; cast through unknown because the generated
                // Insert type requires every NOT NULL column even though computeLicenseEnd + branch logic
                // already guarantees them at runtime.
                const { data, error } = await supabase.from('businesses').insert([dataToSubmit as unknown as never]).select('id').single();
                if (error) throw error;
                return { isNew: true, businessId: data.id };
            }
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ['businesses'] });
            setIsAddEditModalOpen(false);
            setSelectedBusiness(null);

            if (result?.isNew && result.businessId) {
                setNewBusinessId(result.businessId);
                setIsCreateAdminOpen(true);
                toast({ title: "Business created", description: "Now assign a Super Admin to this business." });
            } else {
                toast({ title: "Success", description: "Business information updated." });
            }
        },
        onError: (err) => {
            toast({ title: "Error", description: errorMessage(err), variant: "destructive" });
        }
    });

    const statusChangeMutation = useMutation({
        mutationFn: async ({ businessId, action }: { businessId: string; action: 'extend' | 'suspend' | 'deactivate' | 'reactivate' }) => {
            const target = businesses?.find(b => b.id === businessId);
            if (!target) throw new Error("Business not found");

            const updates: BusinessUpdateFields = { updated_at: new Date().toISOString() };

            switch (action) {
                case 'extend': {
                    const currentEnd = target.license_end ? new Date(target.license_end) : new Date();
                    const base = currentEnd > new Date() ? currentEnd : new Date();
                    updates.license_end = computeLicenseEnd(target.license_type, base);
                    updates.status = 'active';
                    updates.active = true;
                    updates.paid = true;
                    break;
                }
                case 'suspend':
                    updates.status = 'suspended';
                    updates.active = false;
                    updates.paid = false;
                    break;
                case 'deactivate':
                    updates.status = 'deactivated';
                    updates.active = false;
                    break;
                case 'reactivate': {
                    const now = new Date();
                    updates.status = 'active';
                    updates.active = true;
                    updates.paid = true;
                    updates.license_start = now.toISOString();
                    updates.license_end = computeLicenseEnd(target.license_type, now);
                    break;
                }
            }

            const { error } = await supabase.from('businesses').update(updates).eq('id', businessId);
            if (error) throw error;
        },
        onSuccess: (_, { action }) => {
            queryClient.invalidateQueries({ queryKey: ['businesses'] });
            setIsAddEditModalOpen(false);
            setSelectedBusiness(null);
            const labels: Record<string, string> = {
                extend: 'License extended',
                suspend: 'Business suspended',
                deactivate: 'Business deactivated',
                reactivate: 'Business reactivated',
            };
            toast({ title: labels[action], description: "Status updated successfully." });
        },
        onError: (err) => {
            toast({ title: "Error", description: errorMessage(err), variant: "destructive" });
        },
    });

    const createAdminMutation = useMutation({
        mutationFn: async (values: z.infer<typeof adminUserSchema>) => {
            const { data, error } = await supabase.functions.invoke('manage-users', {
                body: {
                    action: 'create',
                    userData: { ...values, role: 'super admin', 'DigiCom Business': newBusinessId },
                },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['businesses'] });
            setIsCreateAdminOpen(false);
            setNewBusinessId(null);
            toast({ title: "Super Admin created", description: "The admin account has been provisioned and linked to the business." });
        },
        onError: (err) => {
            toast({ title: "Error", description: errorMessage(err), variant: "destructive" });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.rpc('delete_business', { p_business_id: id });
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
        onError: (err) => {
            toast({ title: "Deletion Failed", description: errorMessage(err), variant: "destructive" });
        }
    });

    const handleEdit = (business: BusinessRow) => {
        setSelectedBusiness(business);
        setIsAddEditModalOpen(true);
    };

    const handleDeleteClick = (business: BusinessRow) => {
        setSelectedBusiness(business);
        setDeleteStep(1);
        setConfirmName("");
        setConfirmDeleteText("");
        setIsDeleteModalOpen(true);
    };

    const handleStatusChange = (businessId: string, action: 'extend' | 'suspend' | 'deactivate' | 'reactivate') => {
        statusChangeMutation.mutate({ businessId, action });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Business Units</h1>
                            <p className="text-gray-500 font-light">Manage business units, licenses and branches.</p>
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
                                onClick={() => { setSelectedBusiness(null); setIsAddEditModalOpen(true); }}
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
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg w-fit">
                <button
                    onClick={() => setViewMode('grid')}
                    className={cn(
                        "h-7 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all",
                        viewMode === 'grid' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                >
                    <LayoutGrid className="w-3.5 h-3.5" /> Grid
                </button>
                <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                        "h-7 px-3 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all",
                        viewMode === 'list' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                >
                    <List className="w-3.5 h-3.5" /> List
                </button>
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-xl w-full" />)}
                </div>
            ) : filteredBusinesses.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
                    <Building2 className="w-10 h-10 text-slate-300 mb-3" />
                    <p className="text-sm font-medium text-slate-500">No businesses yet</p>
                    <p className="text-xs text-slate-400 mt-1">Create your first business to get started.</p>
                </div>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
                <div className="space-y-2">
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
                onClose={() => { setIsAddEditModalOpen(false); setSelectedBusiness(null); }}
                onSubmit={(values) => upsertMutation.mutate({ ...values, id: selectedBusiness?.id })}
                initialData={selectedBusiness ? {
                    id: selectedBusiness.id,
                    name: selectedBusiness.name,
                    active: selectedBusiness.active ?? true,
                    logo: selectedBusiness.logo,
                    plan_id: selectedBusiness.plan_id || '',
                    status: (selectedBusiness.status as 'active' | 'suspended' | 'deactivated') || 'active',
                    license_end: selectedBusiness.license_end,
                    license_type: selectedBusiness.license_type,
                    paid: selectedBusiness.paid,
                } : undefined}
                loading={upsertMutation.isPending}
                onStatusChange={handleStatusChange}
                statusLoading={statusChangeMutation.isPending}
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

            {/* Create Super Admin Modal */}
            <CreateAdminModal
                isOpen={isCreateAdminOpen}
                onClose={() => { setIsCreateAdminOpen(false); setNewBusinessId(null); }}
                onSubmit={(values) => createAdminMutation.mutate(values)}
                loading={createAdminMutation.isPending}
            />
        </div>
    );
};

// --- Sub-components ---

const StatusDot = ({ status }: { status: string }) => (
    <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[status] || STATUS_DOT.active)} />
);

const LicenseMeta = ({ business }: { business: BusinessRow }) => {
    const type = business.license_type || 'monthly';
    const end = business.license_end ? new Date(business.license_end) : null;
    const isExpired = end && end < new Date();
    const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86400000) : null;
    const status = business.status || 'active';
    const paid = business.paid ?? false;
    const planName = business.plan?.name;

    return (
        <div className="flex items-center gap-2 text-xs text-slate-500">
            <StatusDot status={status} />
            <span className="capitalize">{status}</span>
            <span className="text-slate-300">·</span>
            <span>{planName || type}</span>
            {type !== 'lifetime' && daysLeft !== null && (
                <>
                    <span className="text-slate-300">·</span>
                    <span className={isExpired ? 'text-red-500 font-medium' : ''}>
                        {isExpired ? 'Expired' : `${daysLeft}d left`}
                    </span>
                </>
            )}
            <span className="text-slate-300">·</span>
            <span className={cn('font-medium', paid ? 'text-emerald-600' : 'text-red-500')}>
                {paid ? 'Paid' : 'Unpaid'}
            </span>
        </div>
    );
};

type CardProps = { business: BusinessRow; onEdit: () => void; onDelete: () => void };

const BusinessCard = ({ business, onEdit, onDelete }: CardProps) => (
    <Card className="group border border-slate-200/60 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
        <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between">
                <div className="w-11 h-11 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                    {business.logo ? (
                        <img src={business.logo} alt="" className="w-full h-full object-contain p-1.5" />
                    ) : (
                        <Building2 className="w-5 h-5 text-slate-300" />
                    )}
                </div>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                            <MoreVertical className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-lg border border-slate-200 shadow-lg p-1 min-w-[140px]">
                        <DropdownMenuItem onClick={onEdit} className="rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer gap-2">
                            <Edit2 className="w-3.5 h-3.5" /> Manage
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onDelete} className="rounded-md px-2.5 py-1.5 text-xs font-medium cursor-pointer gap-2 text-red-600 focus:text-red-600 focus:bg-red-50">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            <div>
                <h3 className="text-sm font-semibold text-slate-900 leading-tight">{business.name}</h3>
                <div className="mt-1">
                    <LicenseMeta business={business} />
                </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                        <AvatarImage src={business.creator?.avatar_url} />
                        <AvatarFallback className="bg-slate-100 text-slate-500 text-[9px] font-medium">
                            {business.creator?.name?.substring(0, 2) || '??'}
                        </AvatarFallback>
                    </Avatar>
                    <span className="text-xs text-slate-500">{business.creator?.name || 'N/A'}</span>
                </div>
                <span className="text-[11px] text-slate-400 capitalize">{business.creator?.role || 'Admin'}</span>
            </div>
        </CardContent>
    </Card>
);

const BusinessListItem = ({ business, onEdit, onDelete }: CardProps) => (
    <div className="group flex items-center justify-between px-4 py-3 rounded-lg border border-slate-200/60 bg-white hover:bg-slate-50/50 transition-colors">
        <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                {business.logo ? (
                    <img src={business.logo} alt="" className="w-full h-full object-contain p-1" />
                ) : (
                    <Building2 className="w-4 h-4 text-slate-300" />
                )}
            </div>
            <div className="min-w-0">
                <h4 className="text-sm font-medium text-slate-900 truncate">{business.name}</h4>
                <LicenseMeta business={business} />
            </div>
        </div>

        <div className="flex items-center gap-6 shrink-0">
            <div className="hidden md:flex items-center gap-2">
                <Avatar className="h-5 w-5">
                    <AvatarImage src={business.creator?.avatar_url} />
                    <AvatarFallback className="text-[8px]">{business.creator?.name?.substring(0, 2)}</AvatarFallback>
                </Avatar>
                <span className="text-xs text-slate-500">{business.creator?.name}</span>
            </div>
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
                    <Edit2 className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50">
                    <Trash2 className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
    </div>
);

type DeleteDialogProps = {
    isOpen: boolean;
    onClose: () => void;
    business: BusinessRow | null;
    onConfirm: () => void;
    loading: boolean;
    step: number;
    setStep: (s: number) => void;
    confirmName: string;
    setConfirmName: (s: string) => void;
    confirmDeleteText: string;
    setConfirmDeleteText: (s: string) => void;
};

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
}: DeleteDialogProps) => {
    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-md p-0 border border-slate-200/60 bg-white rounded-2xl shadow-xl overflow-hidden gap-0">
                <div className="px-6 pt-6 pb-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center text-red-500">
                            <AlertTriangle className="w-4.5 h-4.5" />
                        </div>
                        <div>
                            <DialogTitle className="text-lg font-semibold text-slate-900">
                                Delete Business
                            </DialogTitle>
                            <p className="text-xs text-slate-500 mt-0.5">This action is permanent and cannot be undone.</p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-5 space-y-5">
                    <p className="text-sm text-slate-600">
                        You are about to permanently delete <span className="font-semibold text-slate-900">"{business?.name}"</span> and all associated data.
                    </p>

                    <div className="flex items-center gap-1.5">
                        <div className={cn("h-1 flex-1 rounded-full transition-colors", step >= 1 ? "bg-red-400" : "bg-slate-100")} />
                        <div className={cn("h-1 flex-1 rounded-full transition-colors", step >= 2 ? "bg-red-400" : "bg-slate-100")} />
                    </div>

                    {step === 1 ? (
                        <div className="space-y-3">
                            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                Type the business name to confirm
                            </label>
                            <Input
                                placeholder={business?.name}
                                value={confirmName}
                                onChange={(e) => setConfirmName(e.target.value)}
                                className="h-10 rounded-lg border-slate-200 text-sm"
                            />
                            <Button
                                onClick={() => setStep(2)}
                                disabled={confirmName !== business?.name}
                                className="w-full h-9 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-30"
                            >
                                Continue
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[11px] font-semibold uppercase tracking-wider text-red-400">
                                    Type "DELETE" to confirm
                                </label>
                                <button onClick={() => setStep(1)} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Back</button>
                            </div>
                            <Input
                                placeholder="DELETE"
                                value={confirmDeleteText}
                                onChange={(e) => setConfirmDeleteText(e.target.value)}
                                className="h-10 rounded-lg border-red-200 text-sm text-red-600 focus-visible:ring-red-200"
                            />
                            <Button
                                onClick={onConfirm}
                                disabled={confirmDeleteText !== "DELETE" || loading}
                                className="w-full h-9 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-30 gap-2"
                            >
                                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                                Delete Permanently
                            </Button>
                        </div>
                    )}
                </div>

                <div className="px-6 py-3 border-t border-slate-100 flex justify-end">
                    <Button variant="ghost" onClick={onClose} className="h-8 px-3 text-xs text-slate-500 hover:text-slate-700">
                        Cancel
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

type CreateAdminModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (values: z.infer<typeof adminUserSchema>) => void;
    loading: boolean;
};

const CreateAdminModal = ({ isOpen, onClose, onSubmit, loading }: CreateAdminModalProps) => {
    const [avatar, setAvatar] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

    const form = useForm<z.infer<typeof adminUserSchema>>({
        resolver: zodResolver(adminUserSchema),
        defaultValues: { name: '', username: '', email: '', password: '', active: true, avatar_url: null },
    });

    useEffect(() => {
        if (isOpen) {
            form.reset({ name: '', username: '', email: '', password: '', active: true, avatar_url: null });
            setAvatar(null);
            setAvatarPreview(null);
        }
    }, [isOpen, form]);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        const file = acceptedFiles[0];
        setAvatar(file);
        setAvatarPreview(URL.createObjectURL(file));
    }, []);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [] }, multiple: false });

    const handleSubmit = async (values: z.infer<typeof adminUserSchema>) => {
        const finalValues = { ...values };
        if (avatar) {
            const fileExt = avatar.name.split('.').pop();
            const filePath = `avatars/${Math.random()}.${fileExt}`;
            const { error: uploadError } = await supabase.storage.from('avatar').upload(filePath, avatar);
            if (!uploadError) {
                const { data: { publicUrl } } = supabase.storage.from('avatar').getPublicUrl(filePath);
                finalValues.avatar_url = publicUrl;
            }
        }
        onSubmit(finalValues);
    };

    return (
        <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg p-0 border border-slate-200/60 bg-white rounded-2xl shadow-xl overflow-hidden gap-0">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-slate-100">
                            <DialogTitle className="text-lg font-semibold text-slate-900">
                                Assign Super Admin
                            </DialogTitle>
                            <p className="text-xs text-slate-500 mt-0.5">Create the primary administrator for this business.</p>
                        </DialogHeader>

                        <div className="px-6 py-5 space-y-4">
                            {/* Avatar */}
                            <div className="flex items-center gap-3">
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        "relative group flex items-center justify-center border-2 border-dashed rounded-full w-14 h-14 shrink-0 cursor-pointer transition-colors overflow-hidden",
                                        isDragActive ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:border-slate-300",
                                        avatarPreview && "border-transparent"
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {avatarPreview ? (
                                        <>
                                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Upload className="w-4 h-4 text-white" />
                                            </div>
                                        </>
                                    ) : (
                                        <Upload className="w-4 h-4 text-slate-400" />
                                    )}
                                </div>
                                <div>
                                    <p className="text-sm font-medium text-slate-700">Photo</p>
                                    <p className="text-xs text-slate-400">Click or drop</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Full Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="John Doe" {...field} className="h-9 rounded-lg border-slate-200 text-sm" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="username" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Username</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                                                <Input placeholder="johndoe" {...field} className="h-9 pl-7 rounded-lg border-slate-200 text-sm" />
                                            </div>
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                            </div>

                            <FormField control={form.control} name="email" render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Email</FormLabel>
                                    <FormControl>
                                        <Input type="email" placeholder="admin@business.com" {...field} className="h-9 rounded-lg border-slate-200 text-sm" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )} />

                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="password" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Password</FormLabel>
                                        <FormControl>
                                            <Input type="password" placeholder="Min 6 chars" {...field} className="h-9 rounded-lg border-slate-200 text-sm" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="active" render={({ field }) => (
                                    <FormItem className="flex flex-col justify-end">
                                        <FormLabel className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</FormLabel>
                                        <div className="flex items-center gap-2.5 h-9 px-3 bg-slate-50 rounded-lg border border-slate-200">
                                            <Switch checked={field.value} onCheckedChange={field.onChange} className="data-[state=checked]:bg-emerald-500 scale-90" />
                                            <span className="text-xs font-medium text-slate-600">{field.value ? 'Active' : 'Disabled'}</span>
                                        </div>
                                    </FormItem>
                                )} />
                            </div>
                        </div>

                        <DialogFooter className="px-6 py-4 border-t border-slate-100 gap-2 sm:gap-2">
                            <Button type="button" variant="ghost" onClick={onClose} className="h-9 px-4 text-sm text-slate-500 hover:text-slate-700">
                                Skip
                            </Button>
                            <Button type="submit" disabled={loading} className="h-9 px-5 bg-brand-navy hover:bg-brand-navy/90 text-white text-sm font-medium rounded-lg">
                                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                Create Admin
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Businesses;
