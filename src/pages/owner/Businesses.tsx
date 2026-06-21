import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { edgeFnErrorMessage } from '@/lib/edgeError';
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
    X,
} from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
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
import { UserAvatar } from '@/components/users/UserAvatar';
import { useDropzone } from 'react-dropzone';
import { Switch } from '@/components/ui/switch';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

import { AddEditBusinessModal, BusinessFormValues } from '@/components/businesses/AddEditBusinessModal';

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
    creator: { id: string; name: string | null; avatar_url: string | null; avatar_config?: unknown; role: string | null } | null;
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

const STATUS_CFG: Record<string, { label: string; dot: string; tint: string; text: string; stripe: string }> = {
    active: { label: 'Active', dot: 'bg-ant-green', tint: 'bg-ant-green/12', text: 'text-ant-green', stripe: 'bg-ant-green' },
    suspended: { label: 'Suspended', dot: 'bg-ant-orange', tint: 'bg-ant-orange/12', text: 'text-ant-orange', stripe: 'bg-ant-orange' },
    deactivated: { label: 'Deactivated', dot: 'bg-ant-rose', tint: 'bg-ant-rose/12', text: 'text-ant-rose', stripe: 'bg-ant-rose' },
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
    // Suspend / reactivate reason capture (emailed to the business's super admins).
    const [statusReasonTarget, setStatusReasonTarget] = useState<{ businessId: string; action: 'suspend' | 'reactivate'; name: string } | null>(null);
    const [statusReason, setStatusReason] = useState('');

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: businesses, isLoading } = useQuery({
        queryKey: ['businesses'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('businesses')
                .select(`
                    *,
                    creator:users!businesses_creator_id_fkey(id, name, avatar_url, avatar_config, role),
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

    const stats = useMemo(() => {
        if (!businesses) return { total: 0, active: 0, suspended: 0, deactivated: 0, expired: 0 };
        const now = Date.now();
        let active = 0, suspended = 0, deactivated = 0, expired = 0;
        for (const b of businesses) {
            const s = (b.status || 'active').toLowerCase();
            if (s === 'active') active++;
            else if (s === 'suspended') suspended++;
            else if (s === 'deactivated') deactivated++;
            if (b.license_end && new Date(b.license_end).getTime() < now) expired++;
        }
        return { total: businesses.length, active, suspended, deactivated, expired };
    }, [businesses]);

    const upsertMutation = useMutation({
        mutationFn: async (payload: BusinessFormValues & { id?: string }) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            const { id, status, ...values } = payload;
            void status;
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
        mutationFn: async ({ businessId, action, reason }: { businessId: string; action: 'extend' | 'suspend' | 'deactivate' | 'reactivate'; reason?: string }) => {
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

            // suspend / reactivate → email every super admin of the business (best-effort).
            let notifyWarning: string | null = null;
            if (action === 'suspend' || action === 'reactivate') {
                try {
                    const { data, error: nErr } = await supabase.functions.invoke('business-status-notify', {
                        body: { business_id: businessId, action, reason: reason ?? '', origin: window.location.origin },
                    });
                    if (nErr) notifyWarning = await edgeFnErrorMessage(nErr, data);
                    else if (data && data.ok === false) notifyWarning = data.detail || data.reason || 'notify failed';
                } catch (e) { notifyWarning = (e as Error).message; }
            }
            return { action, notifyWarning };
        },
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['businesses'] });
            setIsAddEditModalOpen(false);
            setSelectedBusiness(null);
            setStatusReasonTarget(null);
            setStatusReason('');
            const labels: Record<string, string> = {
                extend: 'License extended',
                suspend: 'Business suspended',
                deactivate: 'Business deactivated',
                reactivate: 'Business reactivated',
            };
            const notified = res.action === 'suspend' || res.action === 'reactivate';
            toast({
                title: labels[res.action],
                description: notified
                    ? (res.notifyWarning ? 'Status updated — but the email notice could not be sent.' : 'Status updated and the super admins were notified by email.')
                    : 'Status updated successfully.',
            });
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
            if (error) throw new Error(await edgeFnErrorMessage(error, data));
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
            // Edge fn captures the super admins, runs delete_business, then emails business_deleted to them.
            const { data, error } = await supabase.functions.invoke('delete-business', {
                body: { business_id: id, origin: window.location.origin },
            });
            if (error) throw new Error(await edgeFnErrorMessage(error, data));
            if (data && data.ok === false) throw new Error(data.detail || data.reason || 'Deletion failed.');
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
        // Suspend / reactivate capture a reason (emailed to the business's super admins) via a modal.
        if (action === 'suspend' || action === 'reactivate') {
            const target = businesses?.find(b => b.id === businessId);
            setStatusReason('');
            setStatusReasonTarget({ businessId, action, name: target?.name ?? '' });
            return;
        }
        statusChangeMutation.mutate({ businessId, action });
    };

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Businesses
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                            Business units
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Manage tenants, licenses and ownership — every business on the platform.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 lg:flex-initial min-w-[200px]">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <input
                                type="search"
                                placeholder="Search businesses…"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full lg:w-60 h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                                    aria-label="Clear"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper">
                            <button
                                type="button"
                                onClick={() => setViewMode('grid')}
                                className={cn(
                                    'h-8 px-3 rounded-full flex items-center gap-1 text-[11px] font-medium transition-all',
                                    viewMode === 'grid' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                <LayoutGrid className="w-3 h-3" /> Grid
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('list')}
                                className={cn(
                                    'h-8 px-3 rounded-full flex items-center gap-1 text-[11px] font-medium transition-all',
                                    viewMode === 'list' ? 'bg-ant-ink text-ant-light' : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                <List className="w-3 h-3" /> List
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => { setSelectedBusiness(null); setIsAddEditModalOpen(true); }}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 transition-colors shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            New business
                        </button>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                <KpiTile label="Total" value={stats.total} accent="bg-ant-ink" />
                <KpiTile label="Active" value={stats.active} accent="bg-ant-green" />
                <KpiTile label="Suspended" value={stats.suspended} accent="bg-ant-orange" />
                <KpiTile label="Expired" value={stats.expired} accent="bg-ant-rose" />
            </div>

            {/* Content */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 rounded-2xl w-full" />)}
                </div>
            ) : filteredBusinesses.length === 0 ? (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <Building2 className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">No businesses found</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            Create the first business or adjust your search to see results.
                        </p>
                    </div>
                </section>
            ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
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
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-ant-line bg-ant-light/40">
                                    <th className="px-4 py-3 text-left text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">Business</th>
                                    <th className="px-4 py-3 text-left text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid hidden sm:table-cell">Plan</th>
                                    <th className="px-4 py-3 text-left text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid hidden md:table-cell">Status</th>
                                    <th className="px-4 py-3 text-left text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid hidden lg:table-cell">Creator</th>
                                    <th className="px-4 py-3 w-24" />
                                </tr>
                            </thead>
                            <tbody>
                                {filteredBusinesses.map(business => (
                                    <BusinessListItem
                                        key={business.id}
                                        business={business}
                                        onEdit={() => handleEdit(business)}
                                        onDelete={() => handleDeleteClick(business)}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>
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
                onConfirm={() => selectedBusiness && deleteMutation.mutate(selectedBusiness.id)}
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

            {/* Suspend / reactivate — capture a reason, emailed to all the business's super admins */}
            <Dialog open={!!statusReasonTarget} onOpenChange={(v) => { if (!v && !statusChangeMutation.isPending) { setStatusReasonTarget(null); setStatusReason(''); } }}>
                <DialogContent className="max-w-md p-0 border border-ant-line bg-ant-paper rounded-2xl overflow-hidden">
                    <div className={cn('h-[3px] w-full', statusReasonTarget?.action === 'reactivate' ? 'bg-ant-green' : 'bg-ant-orange')} />
                    <DialogHeader className="px-6 pt-5 pb-4 border-b border-ant-line space-y-1.5 text-left">
                        <div className={cn('inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em]', statusReasonTarget?.action === 'reactivate' ? 'text-ant-green' : 'text-ant-orange')}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', statusReasonTarget?.action === 'reactivate' ? 'bg-ant-green' : 'bg-ant-orange')} />
                            {statusReasonTarget?.action === 'reactivate' ? 'Réactivation' : 'Suspension'}
                        </div>
                        <DialogTitle className="font-display text-[18px] leading-tight text-ant-ink">
                            {statusReasonTarget?.action === 'reactivate' ? 'Reactivate this business?' : 'Suspend this business?'}
                        </DialogTitle>
                        <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                            <span className="not-italic font-semibold text-ant-ink">&ldquo;{statusReasonTarget?.name}&rdquo;</span>{' '}
                            — all its super admins will be emailed {statusReasonTarget?.action === 'reactivate' ? 'a reactivation notice.' : 'a suspension notice.'}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="px-6 py-5 space-y-2">
                        <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                            {statusReasonTarget?.action === 'reactivate' ? 'Note (optional)' : 'Reason (optional)'}
                        </label>
                        <textarea
                            value={statusReason}
                            onChange={(e) => setStatusReason(e.target.value)}
                            rows={3}
                            autoFocus
                            placeholder={statusReasonTarget?.action === 'reactivate' ? 'Ex. Paiement régularisé — accès rétabli.' : 'Ex. Paiement en retard / abonnement expiré…'}
                            className="w-full rounded-xl border border-ant-line bg-ant-paper text-[13px] text-ant-ink p-3 resize-none focus:outline-none focus:ring-1 focus:ring-ant-orange/40"
                        />
                        <p className="text-[11px] text-ant-mid">Shown to the super admins in the email. Leave blank to use a default message.</p>
                    </div>
                    <div className="px-6 py-4 border-t border-ant-line flex items-center justify-end gap-2">
                        <button
                            onClick={() => { setStatusReasonTarget(null); setStatusReason(''); }}
                            disabled={statusChangeMutation.isPending}
                            className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light cursor-pointer disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => statusReasonTarget && statusChangeMutation.mutate({ businessId: statusReasonTarget.businessId, action: statusReasonTarget.action, reason: statusReason })}
                            disabled={statusChangeMutation.isPending}
                            className={cn('h-10 px-5 rounded-full text-[12px] font-semibold text-white inline-flex items-center gap-2 cursor-pointer disabled:opacity-50',
                                statusReasonTarget?.action === 'reactivate' ? 'bg-ant-green hover:bg-ant-green/90' : 'bg-ant-orange hover:bg-ant-orange/90')}
                        >
                            {statusChangeMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {statusReasonTarget?.action === 'reactivate' ? 'Reactivate & notify' : 'Suspend & notify'}
                        </button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// --- Sub-components ---

const KpiTile = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
    <div className="bg-ant-paper p-4 md:p-5 flex flex-col gap-2">
        <div className="flex items-center gap-2">
            <span className={cn('w-1 h-4 rounded-full', accent)} />
            <span className="text-[9px] font-medium uppercase tracking-[0.2em] text-ant-mid truncate">{label}</span>
        </div>
        <p className="font-display text-[22px] md:text-[26px] leading-none tabular-nums text-ant-ink">
            {value.toLocaleString('fr-MA')}
        </p>
    </div>
);

const LicenseMeta = ({ business, compact = false }: { business: BusinessRow; compact?: boolean }) => {
    const type = business.license_type || 'monthly';
    const end = business.license_end ? new Date(business.license_end) : null;
    const isExpired = end && end < new Date();
    const daysLeft = end ? Math.ceil((end.getTime() - Date.now()) / 86400000) : null;
    const status = business.status || 'active';
    const paid = business.paid ?? false;
    const cfg = STATUS_CFG[status] || STATUS_CFG.active;

    return (
        <div className={cn('flex items-center gap-2 flex-wrap', compact ? 'text-[10px]' : 'text-[11px]')}>
            <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold uppercase tracking-[0.14em] text-[9px]', cfg.tint, cfg.text)}>
                <span className={cn('w-1 h-1 rounded-full', cfg.dot)} />
                {cfg.label}
            </span>
            {type !== 'lifetime' && daysLeft !== null && (
                <span className={cn('tabular-nums', isExpired ? 'text-ant-rose font-medium' : 'text-ant-mid')}>
                    {isExpired ? 'Expired' : `${daysLeft}d left`}
                </span>
            )}
            {type === 'lifetime' && (
                <span className="text-ant-green font-medium">Lifetime</span>
            )}
            <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium', paid ? 'text-ant-green' : 'text-ant-rose')}>
                <span className={cn('w-1 h-1 rounded-full', paid ? 'bg-ant-green' : 'bg-ant-rose')} />
                {paid ? 'Paid' : 'Unpaid'}
            </span>
        </div>
    );
};

type CardProps = { business: BusinessRow; onEdit: () => void; onDelete: () => void };

const BusinessCard = ({ business, onEdit, onDelete }: CardProps) => {
    const status = business.status || 'active';
    const cfg = STATUS_CFG[status] || STATUS_CFG.active;
    return (
        <div className="group rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/25 transition-colors">
            <div className={cn('h-[3px] w-full', cfg.stripe)} />
            <div className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="h-10 w-10 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                            {business.logo ? (
                                <img src={business.logo} alt="" className="w-full h-full object-contain p-1" />
                            ) : (
                                <Building2 className="w-4 h-4 text-ant-mid" />
                            )}
                        </div>
                        <div className="min-w-0">
                            <p className="font-display text-[14px] text-ant-ink truncate leading-tight">{business.name}</p>
                            <p className="font-serif italic text-[11px] text-ant-mid truncate mt-0.5">
                                {business.plan?.name || business.license_type}
                            </p>
                        </div>
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-light transition-colors shrink-0"
                            >
                                <MoreVertical className="w-3.5 h-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl border-ant-line bg-ant-paper p-1 min-w-[140px] shadow-[0_12px_30px_-12px_rgba(20,20,19,0.25)]">
                            <DropdownMenuItem onClick={onEdit} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 focus:bg-ant-light">
                                <Edit2 className="w-3.5 h-3.5" /> Manage
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-ant-line" />
                            <DropdownMenuItem onClick={onDelete} className="rounded-lg px-2.5 py-2 text-[12px] cursor-pointer gap-2 text-ant-rose focus:text-ant-rose focus:bg-ant-rose/10">
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                <LicenseMeta business={business} />

                <div className="pt-3 border-t border-ant-line flex items-center gap-2">
                    <UserAvatar url={business.creator?.avatar_url} config={(business.creator as any)?.avatar_config} name={business.creator?.name} className="h-6 w-6 border border-ant-line rounded-full" />
                    <span className="text-[11px] text-ant-mid truncate font-medium">{business.creator?.name || '—'}</span>
                    {business.created_at && (
                        <span className="ml-auto text-[10px] text-ant-mid tabular-nums">
                            {format(new Date(business.created_at), 'dd MMM yyyy', { locale: fr })}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

const BusinessListItem = ({ business, onEdit, onDelete }: CardProps) => (
    <tr className="border-b border-ant-line last:border-b-0 hover:bg-ant-light/40 transition-colors">
        <td className="px-4 py-3">
            <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                    {business.logo ? (
                        <img src={business.logo} alt="" className="w-full h-full object-contain p-1" />
                    ) : (
                        <Building2 className="w-4 h-4 text-ant-mid" />
                    )}
                </div>
                <div className="min-w-0">
                    <p className="font-display text-[13px] text-ant-ink truncate leading-tight">{business.name}</p>
                    {business.created_at && (
                        <p className="text-[10px] text-ant-mid tabular-nums mt-0.5">
                            {format(new Date(business.created_at), 'dd MMM yyyy', { locale: fr })}
                        </p>
                    )}
                </div>
            </div>
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-ant-light border border-ant-line text-ant-ink uppercase tracking-[0.14em]">
                {business.plan?.name || business.license_type}
            </span>
        </td>
        <td className="px-4 py-3 hidden md:table-cell">
            <LicenseMeta business={business} compact />
        </td>
        <td className="px-4 py-3 hidden lg:table-cell">
            <div className="flex items-center gap-2">
                <UserAvatar url={business.creator?.avatar_url} config={(business.creator as any)?.avatar_config} name={business.creator?.name} className="h-6 w-6 border border-ant-line rounded-full" />
                <span className="text-[11px] text-ant-ink truncate">{business.creator?.name || '—'}</span>
            </div>
        </td>
        <td className="px-4 py-3">
            <div className="flex items-center gap-1.5 justify-end">
                <button
                    type="button"
                    onClick={onEdit}
                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                    title="Manage"
                >
                    <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onDelete}
                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper flex items-center justify-center text-ant-ink hover:bg-ant-rose/10 hover:text-ant-rose hover:border-ant-rose/30 transition-colors"
                    title="Delete"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </td>
    </tr>
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
}: DeleteDialogProps) => (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className={cn(
            'max-w-md p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden',
            'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
            'sm:rounded-2xl',
            'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
            'max-sm:!translate-x-0 max-sm:!translate-y-0',
            'max-sm:!w-full max-sm:!max-w-none',
            'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
            '[&>button.absolute]:hidden',
        )}>
            <div className="h-[3px] w-full bg-ant-rose" />
            <DialogHeader className="px-5 pt-4 pb-4 border-b border-ant-line text-left space-y-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-xl bg-ant-rose/10 border border-ant-rose/25 flex items-center justify-center text-ant-rose shrink-0">
                            <AlertTriangle className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-ant-rose" />
                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                    Suppression · Définitive
                                </span>
                            </div>
                            <DialogTitle className="font-display text-[18px] leading-tight text-ant-ink">
                                Delete business
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                This action is permanent and cannot be undone.
                            </DialogDescription>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                        aria-label="Close"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </DialogHeader>

            <div className="px-5 py-4 space-y-4">
                <p className="text-[13px] text-ant-ink">
                    You are about to permanently delete{' '}
                    <span className="font-display">"{business?.name}"</span>{' '}
                    and all associated data.
                </p>

                {/* Step indicator */}
                <div className="flex items-center gap-1.5">
                    <div className={cn('h-1 flex-1 rounded-full transition-colors', step >= 1 ? 'bg-ant-rose' : 'bg-ant-line')} />
                    <div className={cn('h-1 flex-1 rounded-full transition-colors', step >= 2 ? 'bg-ant-rose' : 'bg-ant-line')} />
                </div>

                {step === 1 ? (
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                Type the business name to confirm
                            </label>
                            <input
                                type="text"
                                placeholder={business?.name}
                                value={confirmName}
                                onChange={(e) => setConfirmName(e.target.value)}
                                className="w-full h-11 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[13px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            disabled={confirmName !== business?.name}
                            className="w-full h-11 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            Continue
                        </button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-rose">
                                Type "DELETE" to confirm
                            </label>
                            <button
                                type="button"
                                onClick={() => setStep(1)}
                                className="text-[11px] text-ant-mid hover:text-ant-ink transition-colors"
                            >
                                Back
                            </button>
                        </div>
                        <input
                            type="text"
                            placeholder="DELETE"
                            value={confirmDeleteText}
                            onChange={(e) => setConfirmDeleteText(e.target.value)}
                            className="w-full h-11 px-3.5 rounded-xl border border-ant-rose/30 bg-ant-rose/5 text-[13px] text-ant-rose placeholder:text-ant-rose/50 focus:outline-none focus:border-ant-rose focus:ring-2 focus:ring-ant-rose/20 transition-all"
                        />
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={confirmDeleteText !== 'DELETE' || loading}
                            className="w-full h-11 rounded-full bg-ant-rose text-white text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-rose/95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_10px_24px_-10px_rgba(201,57,66,0.5)]"
                        >
                            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Delete permanently
                        </button>
                    </div>
                )}
            </div>

            <div className="px-5 py-3 border-t border-ant-line flex justify-end">
                <button
                    type="button"
                    onClick={onClose}
                    className="h-9 px-4 rounded-full text-[12px] text-ant-mid hover:text-ant-ink transition-colors"
                >
                    Cancel
                </button>
            </div>
        </DialogContent>
    </Dialog>
);

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
            <DialogContent className={cn(
                'max-w-lg p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                'sm:rounded-2xl',
                'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                'max-sm:!translate-x-0 max-sm:!translate-y-0',
                'max-sm:!w-full max-sm:!max-w-none',
                'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                '[&>button.absolute]:hidden',
            )}>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col h-full overflow-hidden">
                        <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                        <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 space-y-1.5 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                            Admin · Super Admin
                                        </span>
                                    </div>
                                    <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                        Assign super admin
                                    </DialogTitle>
                                    <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                        Create the primary administrator for this business.
                                    </DialogDescription>
                                </div>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                    aria-label="Close"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                            {/* Avatar */}
                            <div className="flex items-center gap-3">
                                <div
                                    {...getRootProps()}
                                    className={cn(
                                        'relative group flex items-center justify-center border-2 border-dashed rounded-full w-16 h-16 shrink-0 cursor-pointer transition-colors overflow-hidden',
                                        isDragActive ? 'border-ant-ink bg-ant-ink/5' : 'border-ant-line hover:border-ant-ink/40',
                                        avatarPreview && 'border-transparent',
                                    )}
                                >
                                    <input {...getInputProps()} />
                                    {avatarPreview ? (
                                        <>
                                            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-ant-ink/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Upload className="w-4 h-4 text-ant-light" />
                                            </div>
                                        </>
                                    ) : (
                                        <Upload className="w-4 h-4 text-ant-mid" />
                                    )}
                                </div>
                                <div>
                                    <p className="font-display text-[13px] text-ant-ink">Photo</p>
                                    <p className="font-serif italic text-[11px] text-ant-mid">Click or drop an image</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Full name</FormLabel>
                                        <FormControl>
                                            <input
                                                placeholder="John Doe"
                                                {...field}
                                                className="w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                            />
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="username" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Username</FormLabel>
                                        <FormControl>
                                            <div className="relative">
                                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ant-mid text-[13px]">@</span>
                                                <input
                                                    placeholder="johndoe"
                                                    {...field}
                                                    className="w-full h-10 pl-7 pr-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                                />
                                            </div>
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                            </div>

                            <FormField control={form.control} name="email" render={({ field }) => (
                                <FormItem className="space-y-1.5">
                                    <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Email</FormLabel>
                                    <FormControl>
                                        <input
                                            type="email"
                                            placeholder="admin@business.com"
                                            {...field}
                                            className="w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                        />
                                    </FormControl>
                                    <FormMessage className="text-[10px] text-ant-rose" />
                                </FormItem>
                            )} />

                            <div className="grid grid-cols-2 gap-3">
                                <FormField control={form.control} name="password" render={({ field }) => (
                                    <FormItem className="space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Password</FormLabel>
                                        <FormControl>
                                            <input
                                                type="password"
                                                placeholder="Min 6 chars"
                                                {...field}
                                                className="w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                                            />
                                        </FormControl>
                                        <FormMessage className="text-[10px] text-ant-rose" />
                                    </FormItem>
                                )} />
                                <FormField control={form.control} name="active" render={({ field }) => (
                                    <FormItem className="flex flex-col justify-end space-y-1.5">
                                        <FormLabel className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">Status</FormLabel>
                                        <div className="flex items-center gap-2.5 h-10 px-3.5 bg-ant-light rounded-xl border border-ant-line">
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                className="data-[state=checked]:bg-ant-green scale-90"
                                            />
                                            <span className="text-[11px] font-medium text-ant-ink">
                                                {field.value ? 'Active' : 'Disabled'}
                                            </span>
                                        </div>
                                    </FormItem>
                                )} />
                            </div>
                        </div>

                        <div className="shrink-0 px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 sm:flex-initial h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                            >
                                Skip
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="flex-1 h-11 px-5 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-ink/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                Create admin
                            </button>
                        </div>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
};

export default Businesses;
