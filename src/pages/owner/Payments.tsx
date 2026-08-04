import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
    Search, Loader2, Receipt, Eye, CheckCircle2, XCircle,
    ChevronDown, ChevronUp, Banknote, Save, Building2,
    Calendar, Clock, CreditCard, User, FileText, X,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { imageUrl } from '@/lib/imageUrl';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

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

const STATUS_CFG: Record<string, { label: string; dot: string; tint: string; text: string; stripe: string }> = {
    pending: { label: 'Pending', dot: 'bg-ant-orange', tint: 'bg-ant-orange/12', text: 'text-ant-orange', stripe: 'bg-ant-orange' },
    approved: { label: 'Approved', dot: 'bg-ant-green', tint: 'bg-ant-green/12', text: 'text-ant-green', stripe: 'bg-ant-green' },
    denied: { label: 'Denied', dot: 'bg-ant-rose', tint: 'bg-ant-rose/12', text: 'text-ant-rose', stripe: 'bg-ant-rose' },
};

const BIZ_STATUS_CFG: Record<string, { tint: string; text: string }> = {
    active: { tint: 'bg-ant-green/12', text: 'text-ant-green' },
    suspended: { tint: 'bg-ant-orange/12', text: 'text-ant-orange' },
    deactivated: { tint: 'bg-ant-rose/12', text: 'text-ant-rose' },
};

const TABS = ['all', 'pending', 'approved', 'denied'] as const;
type Tab = typeof TABS[number];

const TAB_LABELS: Record<Tab, string> = {
    all: 'All',
    pending: 'Pending',
    approved: 'Approved',
    denied: 'Denied',
};

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
        staleTime: 60_000,
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
        staleTime: 5 * 60_000,
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
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) throw new Error('Not authenticated');

            // The license window this payment activates — one computation feeds both the
            // payment's covered period (period_start/period_end) and the business's license
            // dates, so they always agree. period_start was stamped at submission time; on
            // approval it is realigned to the actual license start.
            const licenseType = payment.business?.plan?.license_type || payment.business?.license_type || 'monthly';
            const now = new Date();
            const nowIso = now.toISOString();
            const licenseEnd = computeLicenseEnd(licenseType, now);

            const { error: payErr } = await supabase
                .from('business_payments')
                .update({
                    status: 'approved',
                    reviewed_by: user.id,
                    reviewed_at: nowIso,
                    period_start: nowIso,
                    period_end: licenseEnd,
                })
                .eq('id', payment.id);
            if (payErr) throw payErr;

            const { error: bizErr } = await supabase
                .from('businesses')
                .update({
                    status: 'active',
                    active: true,
                    paid: true,
                    license_start: nowIso,
                    license_end: licenseEnd,
                    updated_at: nowIso,
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
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
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

    const inputClass = "w-full h-10 px-3.5 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all";

    return (
        <div className="space-y-5 md:space-y-6">
            {/* Editorial header */}
            <header className="space-y-3">
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                        Platform · Payments
                    </span>
                </div>
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
                    <div className="space-y-1.5">
                        <h1 className="font-display text-[26px] sm:text-[32px] leading-[1.05] tracking-[-0.02em] text-ant-ink flex items-center gap-3 flex-wrap">
                            Payment submissions
                            {counts.pending > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-[0.14em] bg-ant-orange/12 text-ant-orange">
                                    <span className="w-1 h-1 rounded-full bg-ant-orange animate-pulse" />
                                    {counts.pending} pending
                                </span>
                            )}
                        </h1>
                        <p className="font-serif italic text-[13px] sm:text-[14px] leading-relaxed text-ant-mid">
                            Review payment proofs submitted by business admins.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative flex-1 lg:flex-initial min-w-[200px]">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid" strokeWidth={1.75} />
                            <input
                                type="search"
                                placeholder="Search submissions…"
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full lg:w-56 h-10 pl-10 pr-10 rounded-full border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/70 focus:outline-none focus:border-ant-ink focus:ring-2 focus:ring-ant-orange/20 transition-all"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ant-mid hover:text-ant-ink"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => { initBankForm(); setBankOpen(!bankOpen); }}
                            className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                        >
                            <Banknote className="w-3.5 h-3.5" />
                            Bank info
                            {bankOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                    </div>
                </div>
            </header>

            {/* KPI hairline strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl overflow-hidden border border-ant-line">
                <KpiTile label="Pending" value={counts.pending} accent="bg-ant-orange" />
                <KpiTile label="Approved" value={counts.approved} accent="bg-ant-green" />
                <KpiTile label="Denied" value={counts.denied} accent="bg-ant-rose" />
                <KpiTile label="Total" value={counts.all} accent="bg-ant-ink" />
            </div>

            {/* Bank Settings Panel */}
            {bankOpen && (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-ink" />
                    <div className="px-4 md:px-6 py-4 md:py-5 border-b border-ant-line">
                        <div className="flex items-center gap-2">
                            <span className="font-display text-[11px] text-ant-orange">01</span>
                            <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                Platform bank information
                            </span>
                        </div>
                        <p className="font-serif italic text-[12px] text-ant-mid mt-1">
                            These details are shown to business admins for wire transfers.
                        </p>
                    </div>
                    <div className="p-4 md:p-6 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {[
                                { key: 'bank_name', label: 'Bank name' },
                                { key: 'bank_account_holder', label: 'Account holder' },
                                { key: 'bank_rib', label: 'RIB' },
                                { key: 'bank_iban', label: 'IBAN' },
                            ].map(f => (
                                <div key={f.key} className="space-y-1.5">
                                    <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                                        {f.label}
                                    </label>
                                    <input
                                        className={inputClass}
                                        value={bankForm[f.key] ?? bankSettings?.[f.key] ?? ''}
                                        onChange={e => setBankForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex justify-end pt-2 border-t border-ant-line">
                            <button
                                type="button"
                                disabled={!bankDirty || saveBankMutation.isPending}
                                onClick={() => saveBankMutation.mutate()}
                                className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-ant-ink text-ant-light text-[12px] font-medium hover:bg-ant-ink/95 disabled:opacity-40 transition-all shadow-[0_10px_24px_-10px_rgba(20,20,19,0.5)]"
                            >
                                {saveBankMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                Save
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* Tabs pill-group */}
            <div className="overflow-x-auto no-scrollbar">
                <div className="inline-flex items-center gap-0.5 p-1 rounded-full border border-ant-line bg-ant-paper min-w-min">
                    {TABS.map(tab => {
                        const isActive = activeTab === tab;
                        return (
                            <button
                                key={tab}
                                type="button"
                                onClick={() => setActiveTab(tab)}
                                className={cn(
                                    'shrink-0 h-9 px-3.5 rounded-full flex items-center gap-1.5 text-[12px] font-medium transition-all',
                                    isActive ? 'bg-ant-ink text-ant-light shadow-[0_6px_18px_-6px_rgba(20,20,19,0.35)]' : 'text-ant-mid hover:text-ant-ink',
                                )}
                            >
                                <span>{TAB_LABELS[tab]}</span>
                                <span className={cn(
                                    'px-1.5 min-w-[20px] h-[18px] rounded-full text-[10px] font-semibold tabular-nums inline-flex items-center justify-center',
                                    isActive ? 'bg-white/15 text-ant-light' : 'bg-ant-line text-ant-mid',
                                )}>
                                    {counts[tab]}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Loading */}
            {isLoading && (
                <div className="space-y-2">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-2xl" />)}
                </div>
            )}

            {/* Empty */}
            {!isLoading && filtered.length === 0 && (
                <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                    <div className="h-[3px] w-full bg-ant-orange" />
                    <div className="p-10 flex flex-col items-center gap-3 text-center">
                        <Receipt className="w-6 h-6 text-ant-mid" />
                        <p className="font-display text-[14px] text-ant-ink">No submissions</p>
                        <p className="font-serif italic text-[12px] text-ant-mid max-w-sm">
                            No payment proofs match the current filter.
                        </p>
                    </div>
                </section>
            )}

            {/* List */}
            {!isLoading && filtered.length > 0 && (
                <div className="space-y-3">
                    {filtered.map(payment => {
                        const cfg = STATUS_CFG[payment.status] || STATUS_CFG.pending;
                        return (
                            <article
                                key={payment.id}
                                className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden hover:border-ant-ink/25 transition-colors"
                            >
                                <div className={cn('h-[3px] w-full', cfg.stripe)} />
                                <div className="p-4 md:p-5 flex flex-col md:flex-row md:items-center gap-4">
                                    {/* Business avatar + info */}
                                    <div className="flex items-start gap-3 flex-1 min-w-0">
                                        <Avatar className="w-10 h-10 rounded-xl border border-ant-line shrink-0">
                                            <AvatarImage src={payment.business?.logo ?? undefined} />
                                            <AvatarFallback className="rounded-xl bg-ant-light text-ant-ink text-[11px] font-medium">
                                                {payment.business?.name?.charAt(0)?.toUpperCase() || '?'}
                                            </AvatarFallback>
                                        </Avatar>

                                        <div className="flex-1 min-w-0 space-y-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-display text-[14px] text-ant-ink truncate">
                                                    {payment.business?.name || 'Unknown'}
                                                </span>
                                                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]', cfg.tint, cfg.text)}>
                                                    <span className={cn('w-1 h-1 rounded-full', cfg.dot)} />
                                                    {cfg.label}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 flex-wrap text-[11px] text-ant-mid">
                                                {payment.amount > 0 && (
                                                    <span className="font-display text-[13px] text-ant-ink tabular-nums">
                                                        {payment.amount} <span className="text-[10px] text-ant-mid uppercase">{payment.currency || 'MAD'}</span>
                                                    </span>
                                                )}
                                                {payment.submitter && (
                                                    <span className="font-serif italic">by {payment.submitter.name}</span>
                                                )}
                                                <span className="tabular-nums">
                                                    {format(new Date(payment.created_at), 'dd MMM yyyy', { locale: fr })}
                                                </span>
                                            </div>
                                            {payment.status === 'denied' && payment.denial_message && (
                                                <p className="text-[11px] text-ant-rose italic truncate max-w-md">
                                                    Denied: {payment.denial_message}
                                                </p>
                                            )}
                                            {payment.status === 'approved' && payment.reviewer && (
                                                <p className="text-[11px] text-ant-green">
                                                    Approved by {payment.reviewer.name}
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={() => handlePreview(payment)}
                                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[11px] font-medium hover:bg-ant-ink hover:text-ant-light hover:border-ant-ink transition-colors"
                                        >
                                            <Eye className="w-3.5 h-3.5" />
                                            Preview
                                        </button>
                                        {payment.status === 'pending' && (
                                            <>
                                                <button
                                                    type="button"
                                                    disabled={approveMutation.isPending}
                                                    onClick={() => approveMutation.mutate(payment)}
                                                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-ant-green text-white text-[11px] font-medium hover:bg-ant-green/95 disabled:opacity-60 transition-colors"
                                                >
                                                    {approveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                                    Approve
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => { setDenyId(payment.id); setDenyMessage(''); }}
                                                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ant-rose/30 bg-ant-rose/5 text-ant-rose text-[11px] font-medium hover:bg-ant-rose hover:text-white hover:border-ant-rose transition-colors"
                                                >
                                                    <XCircle className="w-3.5 h-3.5" />
                                                    Deny
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {/* Preview Modal */}
            <Dialog open={!!previewId} onOpenChange={() => { setPreviewId(null); setPreviewProofUrl(null); }}>
                <DialogContent className={cn(
                    'max-w-2xl p-0 gap-0 border border-ant-line bg-ant-paper overflow-hidden flex flex-col max-h-[92vh]',
                    'shadow-[0_32px_80px_-24px_rgba(20,20,19,0.4)]',
                    'sm:rounded-2xl',
                    'max-sm:!left-0 max-sm:!right-0 max-sm:!top-auto max-sm:!bottom-0',
                    'max-sm:!translate-x-0 max-sm:!translate-y-0',
                    'max-sm:!w-full max-sm:!max-w-none',
                    'max-sm:!h-[94dvh] max-sm:!max-h-[94dvh]',
                    'max-sm:!rounded-t-2xl max-sm:!rounded-b-none',
                    '[&>button.absolute]:hidden',
                )}>
                    {previewPayment && (() => {
                        const biz = previewPayment.business;
                        const plan = biz?.plan;
                        const endDate = biz?.license_end ? new Date(biz.license_end) : null;
                        const daysLeft = endDate ? Math.ceil((endDate.getTime() - Date.now()) / 86400000) : null;
                        const isExpired = endDate && endDate < new Date();
                        const payCfg = STATUS_CFG[previewPayment.status] || STATUS_CFG.pending;
                        return (
                            <>
                                <div className="h-[3px] w-full bg-ant-orange shrink-0" />
                                <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0 space-y-1.5 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="w-1.5 h-1.5 rounded-full bg-ant-orange" />
                                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                    Payment · Details
                                                </span>
                                                <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]', payCfg.tint, payCfg.text)}>
                                                    <span className={cn('w-1 h-1 rounded-full', payCfg.dot)} />
                                                    {payCfg.label}
                                                </span>
                                            </div>
                                            <DialogTitle className="font-display text-[20px] leading-[1.1] tracking-[-0.01em] text-ant-ink truncate">
                                                {biz?.name || 'Unknown business'}
                                            </DialogTitle>
                                            <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                                Submitted {format(new Date(previewPayment.created_at), 'dd MMMM yyyy · HH:mm', { locale: fr })}
                                            </DialogDescription>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { setPreviewId(null); setPreviewProofUrl(null); }}
                                            className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                            aria-label="Close"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </DialogHeader>

                                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                                    {/* Business card */}
                                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="h-[3px] w-full bg-ant-ink" />
                                        <div className="p-4 flex items-start gap-3">
                                            <div className="w-12 h-12 rounded-xl bg-ant-light border border-ant-line flex items-center justify-center overflow-hidden shrink-0">
                                                {biz?.logo ? (
                                                    <img src={imageUrl(biz.logo, 'logo')} alt="" className="w-full h-full object-contain p-1.5" />
                                                ) : (
                                                    <Building2 className="w-5 h-5 text-ant-mid" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <p className="font-display text-[14px] text-ant-ink truncate">{biz?.name || 'Unknown'}</p>
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={cn(
                                                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                                                        BIZ_STATUS_CFG[biz?.status || 'active']?.tint || 'bg-ant-mid/10',
                                                        BIZ_STATUS_CFG[biz?.status || 'active']?.text || 'text-ant-mid',
                                                    )}>
                                                        {biz?.status || 'unknown'}
                                                    </span>
                                                    <span className={cn(
                                                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.14em]',
                                                        biz?.paid ? 'bg-ant-green/12 text-ant-green' : 'bg-ant-rose/12 text-ant-rose',
                                                    )}>
                                                        <span className={cn('w-1 h-1 rounded-full', biz?.paid ? 'bg-ant-green' : 'bg-ant-rose')} />
                                                        {biz?.paid ? 'Paid' : 'Unpaid'}
                                                    </span>
                                                </div>
                                                {previewPayment.submitter?.email && (
                                                    <p className="font-serif italic text-[11px] text-ant-mid truncate">
                                                        {previewPayment.submitter.email}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    </section>

                                    {/* Amount ink card */}
                                    <div className="rounded-2xl bg-ant-ink text-ant-light p-4 space-y-2">
                                        <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-light/55">
                                            Amount paid
                                        </span>
                                        <p className="font-display text-[28px] tabular-nums leading-none">
                                            {previewPayment.amount}
                                            <span className="text-[13px] text-ant-light/60 ml-1 font-normal">{previewPayment.currency || 'MAD'}</span>
                                        </p>
                                        <p className="font-serif italic text-[11px] text-ant-light/60 capitalize">
                                            via {previewPayment.payment_method?.replace('_', ' ') || 'unknown'}
                                            {previewPayment.notes && <> · ref <span className="font-mono text-ant-light/80">{previewPayment.notes}</span></>}
                                        </p>
                                    </div>

                                    {/* Plan & License grid */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <InfoCell icon={CreditCard} label="Plan">
                                            <p className="font-display text-[13px] text-ant-ink">{plan?.name || biz?.license_type || '—'}</p>
                                            {plan?.price != null && (
                                                <p className="text-[11px] text-ant-mid tabular-nums mt-0.5">{plan.price} {plan.currency || 'MAD'}</p>
                                            )}
                                        </InfoCell>
                                        <InfoCell icon={Calendar} label="License">
                                            {biz?.license_type === 'lifetime' ? (
                                                <p className="font-display text-[13px] text-ant-green">Lifetime</p>
                                            ) : endDate ? (
                                                <>
                                                    <p className={cn('font-display text-[13px]', isExpired ? 'text-ant-rose' : 'text-ant-ink')}>
                                                        {isExpired ? 'Expired' : `${daysLeft}d left`}
                                                    </p>
                                                    <p className="text-[11px] text-ant-mid tabular-nums mt-0.5">
                                                        Ends {format(endDate, 'dd MMM yyyy', { locale: fr })}
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="font-display text-[13px] text-ant-mid">—</p>
                                            )}
                                        </InfoCell>
                                        <InfoCell icon={Clock} label="Submitted">
                                            <p className="font-display text-[13px] text-ant-ink tabular-nums">
                                                {format(new Date(previewPayment.created_at), 'dd MMM yyyy', { locale: fr })}
                                            </p>
                                            <p className="text-[11px] text-ant-mid tabular-nums mt-0.5">
                                                {format(new Date(previewPayment.created_at), 'HH:mm', { locale: fr })}
                                            </p>
                                        </InfoCell>
                                        <InfoCell icon={User} label="Submitted by">
                                            <p className="font-display text-[13px] text-ant-ink truncate">{previewPayment.submitter?.name || '—'}</p>
                                            {previewPayment.submitter?.email && (
                                                <p className="text-[11px] text-ant-mid truncate mt-0.5">{previewPayment.submitter.email}</p>
                                            )}
                                        </InfoCell>
                                    </div>

                                    {/* Denial reason */}
                                    {previewPayment.status === 'denied' && previewPayment.denial_message && (
                                        <section className="rounded-2xl border border-ant-rose/25 bg-ant-rose/5 overflow-hidden">
                                            <div className="h-[3px] w-full bg-ant-rose" />
                                            <div className="p-4 space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <XCircle className="w-3.5 h-3.5 text-ant-rose" />
                                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                                        Denial reason
                                                    </span>
                                                </div>
                                                <p className="text-[12px] text-ant-ink leading-relaxed">{previewPayment.denial_message}</p>
                                                {previewPayment.reviewer && (
                                                    <p className="font-serif italic text-[11px] text-ant-mid">by {previewPayment.reviewer.name}</p>
                                                )}
                                            </div>
                                        </section>
                                    )}

                                    {/* Proof */}
                                    <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                        <div className="h-[3px] w-full bg-ant-orange" />
                                        <div className="px-4 py-3 border-b border-ant-line">
                                            <div className="flex items-center gap-2">
                                                <FileText className="w-3.5 h-3.5 text-ant-mid" />
                                                <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-mid">
                                                    Payment proof
                                                </span>
                                            </div>
                                        </div>
                                        <div className="p-3">
                                            {previewProofUrl ? (
                                                previewProofUrl.includes('.pdf') ? (
                                                    <iframe src={previewProofUrl} className="w-full h-[420px] rounded-xl border border-ant-line" />
                                                ) : (
                                                    <img src={previewProofUrl} alt="Payment proof" className="w-full rounded-xl border border-ant-line" />
                                                )
                                            ) : (
                                                <div className="flex items-center justify-center h-32 rounded-xl bg-ant-light border border-dashed border-ant-line">
                                                    <Loader2 className="w-5 h-5 text-ant-mid animate-spin" />
                                                </div>
                                            )}
                                        </div>
                                    </section>
                                </div>

                                {/* Actions */}
                                {previewPayment.status === 'pending' && (
                                    <div className="shrink-0 px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setDenyId(previewId);
                                                setDenyMessage('');
                                                setPreviewId(null);
                                                setPreviewProofUrl(null);
                                            }}
                                            className="inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-full border border-ant-rose/30 bg-ant-rose/5 text-ant-rose text-[12px] font-medium hover:bg-ant-rose hover:text-white hover:border-ant-rose transition-colors"
                                        >
                                            <XCircle className="w-3.5 h-3.5" />
                                            Deny
                                        </button>
                                        <button
                                            type="button"
                                            disabled={approveMutation.isPending}
                                            onClick={() => {
                                                if (previewPayment) approveMutation.mutate(previewPayment);
                                                setPreviewId(null);
                                                setPreviewProofUrl(null);
                                            }}
                                            className="flex-1 h-11 px-5 rounded-full bg-ant-green text-white text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-green/95 disabled:opacity-60 transition-all shadow-[0_10px_24px_-10px_rgba(45,122,62,0.5)]"
                                        >
                                            {approveMutation.isPending ? (
                                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            ) : (
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                            )}
                                            Approve payment
                                        </button>
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </DialogContent>
            </Dialog>

            {/* Deny Modal */}
            <Dialog open={!!denyId} onOpenChange={() => setDenyId(null)}>
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
                    <DialogHeader className="px-5 pt-4 pb-4 shrink-0 border-b border-ant-line text-left space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 space-y-1.5 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-ant-rose" />
                                    <span className="font-display text-[10px] uppercase tracking-[0.22em] text-ant-rose">
                                        Payment · Deny
                                    </span>
                                </div>
                                <DialogTitle className="font-display text-[18px] leading-[1.1] tracking-[-0.01em] text-ant-ink">
                                    Deny payment
                                </DialogTitle>
                                <DialogDescription className="font-serif italic text-[12px] text-ant-mid">
                                    The business admin of <span className="font-display not-italic text-ant-ink">{denyTarget?.business?.name}</span> will see this reason.
                                </DialogDescription>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDenyId(null)}
                                className="w-8 h-8 rounded-full border border-ant-line bg-ant-paper hover:bg-ant-light flex items-center justify-center text-ant-ink shrink-0 transition-colors"
                                aria-label="Close"
                            >
                                <X className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </DialogHeader>
                    <div className="px-5 py-4 space-y-3">
                        <label className="text-[10px] font-medium uppercase tracking-[0.22em] text-ant-mid">
                            Reason for denial
                        </label>
                        <textarea
                            placeholder="Explain what's missing or incorrect…"
                            value={denyMessage}
                            onChange={e => setDenyMessage(e.target.value)}
                            rows={4}
                            className="w-full px-3.5 py-3 rounded-xl border border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid/60 focus:outline-none focus:border-ant-rose focus:ring-2 focus:ring-ant-rose/20 resize-none transition-all"
                        />
                    </div>
                    <div className="px-5 py-3 flex flex-row gap-2 bg-ant-paper border-t border-ant-line pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                        <button
                            type="button"
                            onClick={() => setDenyId(null)}
                            className="flex-1 h-11 px-5 rounded-full border border-ant-line bg-ant-paper text-ant-ink text-[12px] font-medium hover:bg-ant-light transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={!denyMessage.trim() || denyMutation.isPending || !denyId}
                            onClick={() => denyId && denyMutation.mutate({ paymentId: denyId, message: denyMessage })}
                            className="flex-1 h-11 px-5 rounded-full bg-ant-rose text-white text-[12px] font-medium flex items-center justify-center gap-2 hover:bg-ant-rose/95 disabled:opacity-40 transition-all shadow-[0_10px_24px_-10px_rgba(201,57,66,0.5)]"
                        >
                            {denyMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            Deny payment
                        </button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

// ── Sub-components ──────────────────────────────────────────────────────

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

const InfoCell = ({
    icon: Icon,
    label,
    children,
}: {
    icon: typeof Building2;
    label: string;
    children: React.ReactNode;
}) => (
    <div className="rounded-xl bg-ant-light border border-ant-line p-3 space-y-1">
        <div className="flex items-center gap-1.5">
            <Icon className="w-3 h-3 text-ant-mid" />
            <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-ant-mid">{label}</span>
        </div>
        {children}
    </div>
);

export default OwnerPayments;
