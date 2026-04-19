import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search, Loader2, Receipt, Eye, CheckCircle2, XCircle,
    ChevronDown, ChevronUp, Banknote, Save, Building2,
    Calendar, Clock, CreditCard, User, FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const LICENSE_DURATIONS: Record<string, number> = {
    monthly: 30,
    yearly: 365,
};

function computeLicenseEnd(type: string, from?: Date): string | null {
    if (type === 'lifetime') return null;
    const start = from || new Date();
    const days = LICENSE_DURATIONS[type] || 30;
    return new Date(start.getTime() + days * 86400000).toISOString();
}

const STATUS_BADGE: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
    denied: 'bg-red-50 text-red-700 border border-red-200',
};

const TABS = ['all', 'pending', 'approved', 'denied'] as const;
type Tab = typeof TABS[number];

type PaymentBusiness = {
    id: string;
    name: string;
    logo: string | null;
    plan_id: string | null;
    license_type: string;
    license_start: string;
    license_end: string | null;
    status: string;
    active: boolean | null;
    paid: boolean;
    plan: {
        id: string;
        name: string;
        license_type: string;
        price: number;
        currency: string | null;
        description: string | null;
    } | null;
};

type PaymentRow = {
    id: string;
    business_id: string;
    amount: number;
    currency: string;
    payment_method: string;
    license_type: string;
    notes: string | null;
    status: string;
    proof_url: string | null;
    denial_message: string | null;
    reviewed_by: string | null;
    reviewed_at: string | null;
    submitted_by: string | null;
    created_at: string;
    business: PaymentBusiness | null;
    submitter: { id: string; name: string | null; avatar_url: string | null; email: string | null } | null;
    reviewer: { id: string; name: string | null } | null;
};

const errorMessage = (err: unknown): string =>
    err instanceof Error ? err.message : String(err);

const OwnerPayments = () => {
    const [searchQuery, setSearchQuery] = useState('');
    const [activeTab, setActiveTab] = useState<Tab>('all');
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [previewProofUrl, setPreviewProofUrl] = useState<string | null>(null);
    const [denyId, setDenyId] = useState<string | null>(null);
    const [denyMessage, setDenyMessage] = useState('');
    const [bankOpen, setBankOpen] = useState(false);

    const { toast } = useToast();
    const queryClient = useQueryClient();

    const { data: payments, isLoading } = useQuery({
        queryKey: ['owner-payment-submissions'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('business_payments')
                .select(`
                    *,
                    business:businesses(id, name, logo, plan_id, license_type, license_start, license_end, status, active, paid,
                        plan:plans(id, name, license_type, price, currency, description)
                    ),
                    submitter:users!business_payments_submitted_by_fkey(id, name, avatar_url, email),
                    reviewer:users!business_payments_reviewed_by_fkey(id, name)
                `)
                .not('proof_url', 'is', null)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data || []) as unknown as PaymentRow[];
        },
    });

    const { data: bankSettings } = useQuery({
        queryKey: ['platform-settings-bank'],
        queryFn: async () => {
            const { data } = await supabase
                .from('platform_settings')
                .select('key, value')
                .in('key', ['bank_name', 'bank_account_holder', 'bank_rib', 'bank_iban']);
            const map: Record<string, string> = {};
            data?.forEach(r => { map[r.key] = r.value; });
            return map;
        },
    });

    const [bankForm, setBankForm] = useState<Record<string, string>>({});
    const bankDirty = useMemo(() => {
        if (!bankSettings) return false;
        return Object.keys(bankForm).some(k => bankForm[k] !== (bankSettings[k] || ''));
    }, [bankForm, bankSettings]);

    const saveBankMutation = useMutation({
        mutationFn: async () => {
            for (const [key, value] of Object.entries(bankForm)) {
                await supabase
                    .from('platform_settings')
                    .update({ value, updated_at: new Date().toISOString() })
                    .eq('key', key);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['platform-settings-bank'] });
            toast({ title: 'Bank info saved' });
        },
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
        },
    });

    const approveMutation = useMutation({
        mutationFn: async (payment: PaymentRow) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { error: payErr } = await supabase
                .from('business_payments')
                .update({
                    status: 'approved',
                    reviewed_by: user.id,
                    reviewed_at: new Date().toISOString(),
                })
                .eq('id', payment.id);
            if (payErr) throw payErr;

            const licenseType = payment.business?.plan?.license_type || payment.business?.license_type || 'monthly';
            const now = new Date();

            const { error: bizErr } = await supabase
                .from('businesses')
                .update({
                    status: 'active',
                    active: true,
                    paid: true,
                    license_start: now.toISOString(),
                    license_end: computeLicenseEnd(licenseType, now),
                    updated_at: now.toISOString(),
                })
                .eq('id', payment.business_id);
            if (bizErr) throw bizErr;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['owner-payment-submissions'] });
            toast({ title: 'Payment approved', description: 'Business has been reactivated.' });
        },
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
        },
    });

    const denyMutation = useMutation({
        mutationFn: async ({ paymentId, message }: { paymentId: string; message: string }) => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const { error } = await supabase
                .from('business_payments')
                .update({
                    status: 'denied',
                    denial_message: message,
                    reviewed_by: user.id,
                    reviewed_at: new Date().toISOString(),
                })
                .eq('id', paymentId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['owner-payment-submissions'] });
            setDenyId(null);
            setDenyMessage('');
            toast({ title: 'Payment denied' });
        },
        onError: (err) => {
            toast({ title: 'Error', description: errorMessage(err), variant: 'destructive' });
        },
    });

    const filtered = useMemo(() => {
        if (!payments) return [];
        return payments.filter(p => {
            if (activeTab !== 'all' && p.status !== activeTab) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                return p.business?.name?.toLowerCase().includes(q) ||
                    p.submitter?.name?.toLowerCase().includes(q);
            }
            return true;
        });
    }, [payments, activeTab, searchQuery]);

    const counts = useMemo(() => {
        if (!payments) return { all: 0, pending: 0, approved: 0, denied: 0 };
        return {
            all: payments.length,
            pending: payments.filter(p => p.status === 'pending').length,
            approved: payments.filter(p => p.status === 'approved').length,
            denied: payments.filter(p => p.status === 'denied').length,
        };
    }, [payments]);

    const previewPayment = useMemo(() => {
        if (!previewId || !payments) return null;
        return payments.find(p => p.id === previewId) || null;
    }, [previewId, payments]);

    const denyTarget = useMemo(() => {
        if (!denyId || !payments) return null;
        return payments.find(p => p.id === denyId) || null;
    }, [denyId, payments]);

    const handlePreview = async (payment: PaymentRow) => {
        setPreviewId(payment.id);
        setPreviewProofUrl(null);
        if (payment.proof_url) {
            const { data } = await supabase.storage
                .from('payment-proofs')
                .createSignedUrl(payment.proof_url, 300);
            if (data?.signedUrl) setPreviewProofUrl(data.signedUrl);
        }
    };

    const initBankForm = () => {
        if (bankSettings && Object.keys(bankForm).length === 0) {
            setBankForm({ ...bankSettings });
        }
    };

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none flex items-center gap-2">
                            Payments
                            {counts.pending > 0 && (
                                <span className="inline-flex items-center h-5 px-1.5 rounded text-[9px] font-semibold bg-amber-100 text-amber-700 uppercase tracking-wide">
                                    {counts.pending} pending
                                </span>
                            )}
                        </h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Review payment proofs submitted by business admins</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                            <Input
                                placeholder="Search payments..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="pl-7 h-8 rounded-md border-gray-200 bg-white text-[11px] w-52"
                            />
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => { initBankForm(); setBankOpen(!bankOpen); }}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1.5 px-3"
                        >
                            <Banknote className="w-3.5 h-3.5" />
                            Bank Info
                            {bankOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </Button>
                    </div>
                </div>
            </header>

            {/* Bank Settings Panel */}
            {bankOpen && (
                <div className="border border-gray-100 shadow-none rounded-xl p-3.5">
                    <h3 className="text-[9px] font-bold text-brand-navy uppercase tracking-[0.18em] mb-3 flex items-center gap-1.5">
                        <Banknote className="w-3 h-3" /> Platform Bank Information
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {[
                            { key: 'bank_name', label: 'Bank Name' },
                            { key: 'bank_account_holder', label: 'Account Holder' },
                            { key: 'bank_rib', label: 'RIB' },
                            { key: 'bank_iban', label: 'IBAN' },
                        ].map(f => (
                            <div key={f.key}>
                                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.18em]">
                                    {f.label}
                                </label>
                                <Input
                                    className="mt-1 h-8 rounded-md border-gray-200 text-[11px]"
                                    value={bankForm[f.key] ?? bankSettings?.[f.key] ?? ''}
                                    onChange={e => setBankForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                                />
                            </div>
                        ))}
                    </div>
                    <div className="flex justify-end mt-3">
                        <Button
                            size="sm"
                            disabled={!bankDirty || saveBankMutation.isPending}
                            onClick={() => saveBankMutation.mutate()}
                            className="h-8 rounded-md text-[11px] font-semibold gap-1.5"
                        >
                            {saveBankMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Save
                        </Button>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
                <TabsList className="h-8">
                    {TABS.map(tab => (
                        <TabsTrigger key={tab} value={tab} className="text-[11px] h-6 px-3 gap-1.5 capitalize">
                            {tab} ({counts[tab]})
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            {/* Loading */}
            {isLoading && (
                <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
                </div>
            )}

            {/* Empty */}
            {!isLoading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed border-gray-200 bg-white">
                    <Receipt className="w-6 h-6 text-gray-300 mb-2" />
                    <p className="text-[11px] font-medium text-gray-500">No payment submissions found.</p>
                </div>
            )}

            {/* List */}
            {!isLoading && filtered.length > 0 && (
                <div className="space-y-2">
                    {filtered.map(payment => (
                        <div key={payment.id} className="border border-gray-100 shadow-none rounded-xl p-3.5 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-3">
                                {/* Business avatar */}
                                <Avatar className="w-8 h-8 rounded-md shrink-0">
                                    <AvatarImage src={payment.business?.logo ?? undefined} />
                                    <AvatarFallback className="rounded-md bg-brand-navy/10 text-brand-navy text-[10px] font-bold">
                                        {payment.business?.name?.charAt(0)?.toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[12px] font-semibold text-brand-navy truncate">
                                            {payment.business?.name}
                                        </span>
                                        <span className={cn(
                                            'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded',
                                            STATUS_BADGE[payment.status] || STATUS_BADGE.pending
                                        )}>
                                            {payment.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5">
                                        {payment.amount > 0 && (
                                            <span className="text-[11px] font-semibold text-brand-navy tabular-nums">{payment.amount} {payment.currency || 'MAD'}</span>
                                        )}
                                        {payment.submitter && (
                                            <span className="text-[11px] text-gray-400">by {payment.submitter.name}</span>
                                        )}
                                        <span className="text-[11px] text-gray-400 tabular-nums">{new Date(payment.created_at).toLocaleDateString()}</span>
                                        {payment.status === 'denied' && payment.denial_message && (
                                            <span className="text-[11px] text-red-500 truncate max-w-[200px]">
                                                Denied: {payment.denial_message}
                                            </span>
                                        )}
                                        {payment.status === 'approved' && payment.reviewer && (
                                            <span className="text-[11px] text-emerald-600">
                                                Approved by {payment.reviewer.name}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 shrink-0">
                                    <Button
                                        variant="outline"
                                        className="h-8 gap-1.5 text-[11px] font-semibold rounded-md"
                                        onClick={() => handlePreview(payment)}
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                        Preview
                                    </Button>
                                    {payment.status === 'pending' && (
                                        <>
                                            <Button
                                                className="h-8 gap-1.5 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
                                                disabled={approveMutation.isPending}
                                                onClick={() => approveMutation.mutate(payment)}
                                            >
                                                {approveMutation.isPending ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                )}
                                                Approve
                                            </Button>
                                            <Button
                                                variant="outline"
                                                className="h-8 gap-1.5 text-[11px] font-semibold rounded-md text-red-600 border-red-200 hover:bg-red-50"
                                                onClick={() => { setDenyId(payment.id); setDenyMessage(''); }}
                                            >
                                                <XCircle className="w-3.5 h-3.5" />
                                                Deny
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Preview Modal */}
            <Dialog open={!!previewId} onOpenChange={() => { setPreviewId(null); setPreviewProofUrl(null); }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-100 rounded-xl p-0 gap-0">
                    <DialogHeader className="px-5 pt-5 pb-4 border-b border-gray-100">
                        <DialogTitle className="text-[14px] font-semibold text-brand-navy">Payment Details</DialogTitle>
                    </DialogHeader>
                    {previewPayment && (() => {
                        const biz = previewPayment.business;
                        const plan = biz?.plan;
                        const endDate = biz?.license_end ? new Date(biz.license_end) : null;
                        const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86400000) : null;
                        const isExpired = endDate && endDate < new Date();
                        return (
                            <div className="px-5 py-4 space-y-4">
                                {/* Business Info */}
                                <div className="flex items-start gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                    <div className="w-10 h-10 rounded-md bg-white border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                                        {biz?.logo ? (
                                            <img src={biz.logo} alt="" className="w-full h-full object-contain p-1" />
                                        ) : (
                                            <Building2 className="w-4 h-4 text-gray-300" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[12px] font-semibold text-brand-navy truncate">{biz?.name || 'Unknown'}</p>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                            <span className={cn(
                                                'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border',
                                                biz?.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    : biz?.status === 'suspended' ? 'bg-red-50 text-red-700 border-red-200'
                                                    : 'bg-gray-50 text-gray-600 border-gray-200'
                                            )}>
                                                {biz?.status || 'unknown'}
                                            </span>
                                            <span className={cn(
                                                'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border',
                                                biz?.paid ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
                                            )}>
                                                {biz?.paid ? 'Paid' : 'Unpaid'}
                                            </span>
                                        </div>
                                        {previewPayment.submitter?.email && (
                                            <p className="text-[11px] text-gray-400 mt-1">{previewPayment.submitter.email}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Plan & License grid */}
                                <div className="grid grid-cols-2 gap-2.5">
                                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <CreditCard className="w-3 h-3 text-gray-400" />
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Plan</span>
                                        </div>
                                        <p className="text-[12px] font-semibold text-brand-navy">{plan?.name || biz?.license_type || '—'}</p>
                                        {plan?.price != null && (
                                            <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">{plan.price} {plan.currency || 'MAD'}</p>
                                        )}
                                    </div>
                                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <Calendar className="w-3 h-3 text-gray-400" />
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">License</span>
                                        </div>
                                        {biz?.license_type === 'lifetime' ? (
                                            <p className="text-[12px] font-semibold text-emerald-600">Lifetime</p>
                                        ) : endDate ? (
                                            <>
                                                <p className={cn('text-[12px] font-semibold', isExpired ? 'text-red-600' : 'text-brand-navy')}>
                                                    {isExpired ? 'Expired' : `${daysLeft}d left`}
                                                </p>
                                                <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                                                    Ends {endDate.toLocaleDateString()}
                                                </p>
                                            </>
                                        ) : (
                                            <p className="text-[12px] font-semibold text-gray-400">—</p>
                                        )}
                                    </div>
                                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <Clock className="w-3 h-3 text-gray-400" />
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Submitted</span>
                                        </div>
                                        <p className="text-[12px] font-semibold text-brand-navy tabular-nums">
                                            {new Date(previewPayment.created_at).toLocaleDateString()}
                                        </p>
                                        <p className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                                            {new Date(previewPayment.created_at).toLocaleTimeString()}
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <User className="w-3 h-3 text-gray-400" />
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Submitted By</span>
                                        </div>
                                        <p className="text-[12px] font-semibold text-brand-navy">{previewPayment.submitter?.name || '—'}</p>
                                        {previewPayment.submitter?.email && (
                                            <p className="text-[11px] text-gray-400 mt-0.5">{previewPayment.submitter.email}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Payment Info */}
                                <div className="flex items-center gap-4 p-3 rounded-xl bg-gray-50 border border-gray-100">
                                    <div className="flex-1">
                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Amount Paid</span>
                                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-0.5">
                                            {previewPayment.amount} <span className="text-[11px] font-normal text-gray-400">{previewPayment.currency || 'MAD'}</span>
                                        </p>
                                    </div>
                                    {previewPayment.notes && (
                                        <div className="flex-1">
                                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Transfer Ref</span>
                                            <p className="text-[12px] font-semibold text-brand-navy font-mono mt-0.5">{previewPayment.notes}</p>
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Method</span>
                                        <p className="text-[12px] font-semibold text-brand-navy capitalize mt-0.5">{previewPayment.payment_method?.replace('_', ' ') || '—'}</p>
                                    </div>
                                </div>

                                {/* Payment Status */}
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Status:</span>
                                    <span className={cn(
                                        'text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border',
                                        STATUS_BADGE[previewPayment.status] || STATUS_BADGE.pending
                                    )}>
                                        {previewPayment.status}
                                    </span>
                                    {previewPayment.status === 'approved' && previewPayment.reviewer && (
                                        <span className="text-[11px] text-emerald-600">by {previewPayment.reviewer.name}</span>
                                    )}
                                    {previewPayment.status === 'denied' && previewPayment.reviewer && (
                                        <span className="text-[11px] text-red-500">by {previewPayment.reviewer.name}</span>
                                    )}
                                </div>

                                {previewPayment.status === 'denied' && previewPayment.denial_message && (
                                    <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-red-700 mb-1">Denial Reason</p>
                                        <p className="text-[11px] text-red-700">{previewPayment.denial_message}</p>
                                    </div>
                                )}

                                {/* Proof */}
                                <div>
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <FileText className="w-3 h-3 text-gray-400" />
                                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.14em]">Payment Proof</span>
                                    </div>
                                    {previewProofUrl ? (
                                        previewProofUrl.includes('.pdf') ? (
                                            <iframe src={previewProofUrl} className="w-full h-[400px] rounded-xl border border-gray-100" />
                                        ) : (
                                            <img src={previewProofUrl} alt="Payment proof" className="w-full rounded-xl border border-gray-100" />
                                        )
                                    ) : (
                                        <div className="flex items-center justify-center h-32 rounded-xl bg-gray-50 border border-dashed border-gray-200">
                                            <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                {previewPayment.status === 'pending' && (
                                    <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t border-gray-100">
                                        <Button
                                            variant="outline"
                                            className="h-8 gap-1.5 text-[11px] font-semibold rounded-md text-red-600 border-red-200 hover:bg-red-50"
                                            onClick={() => {
                                                setDenyId(previewId);
                                                setDenyMessage('');
                                                setPreviewId(null);
                                                setPreviewProofUrl(null);
                                            }}
                                        >
                                            <XCircle className="w-3.5 h-3.5" />
                                            Deny
                                        </Button>
                                        <Button
                                            className="h-8 gap-1.5 text-[11px] font-semibold rounded-md bg-emerald-600 hover:bg-emerald-700 text-white"
                                            disabled={approveMutation.isPending}
                                            onClick={() => {
                                                if (previewPayment) approveMutation.mutate(previewPayment);
                                                setPreviewId(null);
                                                setPreviewProofUrl(null);
                                            }}
                                        >
                                            {approveMutation.isPending ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                            )}
                                            Approve
                                        </Button>
                                    </DialogFooter>
                                )}
                            </div>
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* Deny Modal */}
            <Dialog open={!!denyId} onOpenChange={() => setDenyId(null)}>
                <DialogContent className="max-w-md border border-gray-100 rounded-xl p-0 gap-0">
                    <DialogHeader className="px-5 pt-5 pb-4 border-b border-gray-100">
                        <DialogTitle className="text-[14px] font-semibold text-brand-navy">Deny Payment</DialogTitle>
                    </DialogHeader>
                    <div className="px-5 py-4 space-y-3">
                        <p className="text-[11px] text-gray-500">
                            Provide a reason for denying this payment from <strong className="text-brand-navy">{denyTarget?.business?.name}</strong>.
                            This message will be shown to the business admin.
                        </p>
                        <Textarea
                            placeholder="Reason for denial..."
                            value={denyMessage}
                            onChange={e => setDenyMessage(e.target.value)}
                            rows={3}
                            className="rounded-md border-gray-200 text-[11px] resize-none"
                        />
                    </div>
                    <DialogFooter className="px-5 py-4 border-t border-gray-100 gap-2 sm:gap-2">
                        <Button variant="outline" className="h-8 text-[11px] font-semibold rounded-md" onClick={() => setDenyId(null)}>
                            Cancel
                        </Button>
                        <Button
                            className="h-8 text-[11px] font-semibold rounded-md bg-red-600 hover:bg-red-700 text-white"
                            disabled={!denyMessage.trim() || denyMutation.isPending || !denyId}
                            onClick={() => denyId && denyMutation.mutate({ paymentId: denyId, message: denyMessage })}
                        >
                            {denyMutation.isPending && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                            Deny Payment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default OwnerPayments;
