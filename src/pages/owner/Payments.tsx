import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search, Loader2, Receipt, Eye, CheckCircle2, XCircle,
    ChevronDown, ChevronUp, Banknote, Save, Building2,
    Calendar, Clock, CreditCard, User, FileText,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
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

const STATUS_STYLE: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    denied: 'bg-red-50 text-red-700 border-red-200',
};

const TABS = ['all', 'pending', 'approved', 'denied'] as const;
type Tab = typeof TABS[number];

// business_payments + joined business/plan/users (verified via MCP).
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

    const { data: bankSettings, isLoading: bankLoading } = useQuery({
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
        <div className="space-y-6">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2 flex items-center gap-3">
                                Payments
                                {counts.pending > 0 && (
                                    <span className="text-sm font-bold bg-amber-100 text-amber-700 px-2.5 py-0.5 rounded-full">
                                        {counts.pending} pending
                                    </span>
                                )}
                            </h1>
                            <p className="text-gray-500 font-light">Review payment proofs submitted by business admins.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3 items-center">
                            <div className="relative group sm:w-80">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary transition-colors" />
                                <Input
                                    placeholder="Search payments..."
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    className="pl-11 h-12 rounded-2xl border-gray-100 bg-white"
                                />
                            </div>
                            <Button
                                variant="outline"
                                onClick={() => { initBankForm(); setBankOpen(!bankOpen); }}
                                className="h-12 px-6 rounded-2xl gap-2 w-full sm:w-auto"
                            >
                                <Banknote className="w-4 h-4" />
                                Bank Info
                                {bankOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bank Settings Panel */}
            {bankOpen && (
                <Card className="border rounded-lg">
                    <CardContent className="p-5">
                        <h3 className="text-sm font-bold text-brand-navy uppercase tracking-wide mb-4 flex items-center gap-2">
                            <Banknote className="w-4 h-4" /> Platform Bank Information
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {[
                                { key: 'bank_name', label: 'Bank Name' },
                                { key: 'bank_account_holder', label: 'Account Holder' },
                                { key: 'bank_rib', label: 'RIB' },
                                { key: 'bank_iban', label: 'IBAN' },
                            ].map(f => (
                                <div key={f.key}>
                                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        {f.label}
                                    </label>
                                    <Input
                                        className="mt-1 h-9"
                                        value={bankForm[f.key] ?? bankSettings?.[f.key] ?? ''}
                                        onChange={e => setBankForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end mt-4">
                            <Button
                                size="sm"
                                disabled={!bankDirty || saveBankMutation.isPending}
                                onClick={() => saveBankMutation.mutate()}
                                className="gap-2"
                            >
                                {saveBankMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                                Save
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg w-fit">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={cn(
                            'h-7 px-3 rounded-md text-xs font-medium capitalize transition-all',
                            activeTab === tab
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                        )}
                    >
                        {tab} ({counts[tab]})
                    </button>
                ))}
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="space-y-3">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}
                </div>
            )}

            {/* Empty */}
            {!isLoading && filtered.length === 0 && (
                <div className="text-center py-16">
                    <Receipt className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">No payment submissions found.</p>
                </div>
            )}

            {/* List */}
            {!isLoading && filtered.length > 0 && (
                <div className="space-y-3">
                    {filtered.map(payment => (
                        <Card key={payment.id} className="border rounded-lg hover:shadow-sm transition-shadow">
                            <CardContent className="p-4">
                                <div className="flex items-center gap-4">
                                    {/* Business avatar */}
                                    <Avatar className="w-10 h-10 rounded-lg shrink-0">
                                        <AvatarImage src={payment.business?.logo} />
                                        <AvatarFallback className="rounded-lg bg-brand-navy/10 text-brand-navy text-xs font-bold">
                                            {payment.business?.name?.charAt(0)?.toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>

                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-sm text-brand-navy truncate">
                                                {payment.business?.name}
                                            </span>
                                            <span className={cn(
                                                'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border',
                                                STATUS_STYLE[payment.status] || STATUS_STYLE.pending
                                            )}>
                                                {payment.status}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                                            {payment.amount > 0 && (
                                                <span className="font-semibold text-slate-700">{payment.amount} {payment.currency || 'MAD'}</span>
                                            )}
                                            {payment.submitter && (
                                                <span>by {payment.submitter.name}</span>
                                            )}
                                            <span>{new Date(payment.created_at).toLocaleDateString()}</span>
                                            {payment.status === 'denied' && payment.denial_message && (
                                                <span className="text-red-500 truncate max-w-[200px]">
                                                    Denied: {payment.denial_message}
                                                </span>
                                            )}
                                            {payment.status === 'approved' && payment.reviewer && (
                                                <span className="text-emerald-600">
                                                    Approved by {payment.reviewer.name}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 gap-1.5 text-xs"
                                            onClick={() => handlePreview(payment)}
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                            Preview
                                        </Button>
                                        {payment.status === 'pending' && (
                                            <>
                                                <Button
                                                    size="sm"
                                                    className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700"
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
                                                    size="sm"
                                                    className="h-8 gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                                    onClick={() => { setDenyId(payment.id); setDenyMessage(''); }}
                                                >
                                                    <XCircle className="w-3.5 h-3.5" />
                                                    Deny
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Preview Modal */}
            <Dialog open={!!previewId} onOpenChange={() => { setPreviewId(null); setPreviewProofUrl(null); }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="text-lg font-semibold">Payment Details</DialogTitle>
                    </DialogHeader>
                    {previewPayment && (() => {
                        const biz = previewPayment.business;
                        const plan = biz?.plan;
                        const endDate = biz?.license_end ? new Date(biz.license_end) : null;
                        const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86400000) : null;
                        const isExpired = endDate && endDate < new Date();
                        return (
                            <div className="space-y-5">
                                {/* Business Info */}
                                <div className="flex items-start gap-4 p-4 rounded-xl bg-slate-50 border border-slate-100">
                                    <div className="w-12 h-12 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                                        {biz?.logo ? (
                                            <img src={biz.logo} alt="" className="w-full h-full object-contain p-1.5" />
                                        ) : (
                                            <Building2 className="w-5 h-5 text-slate-300" />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-slate-900 truncate">{biz?.name || 'Unknown'}</h3>
                                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                                            <span className={cn(
                                                'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border',
                                                biz?.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    : biz?.status === 'suspended' ? 'bg-red-50 text-red-700 border-red-200'
                                                    : 'bg-slate-50 text-slate-600 border-slate-200'
                                            )}>
                                                {biz?.status || 'unknown'}
                                            </span>
                                            <span className={cn(
                                                'text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border',
                                                biz?.paid ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
                                            )}>
                                                {biz?.paid ? 'Paid' : 'Unpaid'}
                                            </span>
                                        </div>
                                        {previewPayment.submitter?.email && (
                                            <p className="text-xs text-slate-500 mt-1.5">{previewPayment.submitter.email}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Plan & License */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                                            <CreditCard className="w-3.5 h-3.5" />
                                            Plan
                                        </div>
                                        <p className="font-semibold text-sm text-slate-900">{plan?.name || biz?.license_type || '—'}</p>
                                        {plan?.price != null && (
                                            <p className="text-xs text-slate-500 mt-0.5">{plan.price} {plan.currency || 'MAD'}</p>
                                        )}
                                    </div>
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                                            <Calendar className="w-3.5 h-3.5" />
                                            License
                                        </div>
                                        {biz?.license_type === 'lifetime' ? (
                                            <p className="font-semibold text-sm text-emerald-600">Lifetime</p>
                                        ) : endDate ? (
                                            <>
                                                <p className={cn('font-semibold text-sm', isExpired ? 'text-red-600' : 'text-slate-900')}>
                                                    {isExpired ? 'Expired' : `${daysLeft}d left`}
                                                </p>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    Ends {endDate.toLocaleDateString()}
                                                </p>
                                            </>
                                        ) : (
                                            <p className="font-semibold text-sm text-slate-400">—</p>
                                        )}
                                    </div>
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                                            <Clock className="w-3.5 h-3.5" />
                                            Submitted
                                        </div>
                                        <p className="font-semibold text-sm text-slate-900">
                                            {new Date(previewPayment.created_at).toLocaleDateString()}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            {new Date(previewPayment.created_at).toLocaleTimeString()}
                                        </p>
                                    </div>
                                    <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                                            <User className="w-3.5 h-3.5" />
                                            Submitted By
                                        </div>
                                        <p className="font-semibold text-sm text-slate-900">{previewPayment.submitter?.name || '—'}</p>
                                        {previewPayment.submitter?.email && (
                                            <p className="text-xs text-slate-500 mt-0.5">{previewPayment.submitter.email}</p>
                                        )}
                                    </div>
                                </div>

                                {/* Payment Info */}
                                <div className="flex items-center gap-4 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                    <div className="flex-1">
                                        <span className="text-xs text-slate-500">Amount Paid</span>
                                        <p className="font-bold text-lg text-slate-900">
                                            {previewPayment.amount} <span className="text-xs font-normal text-slate-500">{previewPayment.currency || 'MAD'}</span>
                                        </p>
                                    </div>
                                    {previewPayment.notes && (
                                        <div className="flex-1">
                                            <span className="text-xs text-slate-500">Transfer Ref</span>
                                            <p className="font-semibold text-sm text-slate-900 font-mono">{previewPayment.notes}</p>
                                        </div>
                                    )}
                                    <div className="flex-1">
                                        <span className="text-xs text-slate-500">Method</span>
                                        <p className="font-semibold text-sm text-slate-900 capitalize">{previewPayment.payment_method?.replace('_', ' ') || '—'}</p>
                                    </div>
                                </div>

                                {/* Payment Status */}
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-slate-500">Status:</span>
                                    <span className={cn(
                                        'text-xs font-bold uppercase px-2.5 py-1 rounded-full border',
                                        STATUS_STYLE[previewPayment.status] || STATUS_STYLE.pending
                                    )}>
                                        {previewPayment.status}
                                    </span>
                                    {previewPayment.status === 'approved' && previewPayment.reviewer && (
                                        <span className="text-xs text-emerald-600">by {previewPayment.reviewer.name}</span>
                                    )}
                                    {previewPayment.status === 'denied' && previewPayment.reviewer && (
                                        <span className="text-xs text-red-500">by {previewPayment.reviewer.name}</span>
                                    )}
                                </div>

                                {previewPayment.status === 'denied' && previewPayment.denial_message && (
                                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                                        <p className="font-semibold text-xs uppercase tracking-wide mb-1">Denial Reason</p>
                                        {previewPayment.denial_message}
                                    </div>
                                )}

                                {/* Proof */}
                                <div>
                                    <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
                                        <FileText className="w-3.5 h-3.5" />
                                        Payment Proof
                                    </div>
                                    {previewProofUrl ? (
                                        previewProofUrl.includes('.pdf') ? (
                                            <iframe src={previewProofUrl} className="w-full h-[400px] rounded-lg border" />
                                        ) : (
                                            <img src={previewProofUrl} alt="Payment proof" className="w-full rounded-lg border" />
                                        )
                                    ) : (
                                        <div className="flex items-center justify-center h-32 rounded-lg bg-slate-50 border border-dashed border-slate-200">
                                            <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                {previewPayment.status === 'pending' && (
                                    <DialogFooter className="gap-2 sm:gap-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
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
                                            size="sm"
                                            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
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
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Deny Payment</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Provide a reason for denying this payment from <strong>{denyTarget?.business?.name}</strong>.
                        This message will be shown to the business admin.
                    </p>
                    <Textarea
                        placeholder="Reason for denial..."
                        value={denyMessage}
                        onChange={e => setDenyMessage(e.target.value)}
                        rows={3}
                    />
                    <DialogFooter>
                        <Button variant="outline" size="sm" onClick={() => setDenyId(null)}>
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            variant="destructive"
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
