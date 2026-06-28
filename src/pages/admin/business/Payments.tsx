import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
    Loader2,
    Receipt,
    ChevronRight,
    FileImage,
    X,
    CheckCircle2,
    Clock,
    XCircle,
    CreditCard,
    Landmark,
    Banknote,
    Globe,
    HelpCircle,
    ExternalLink,
    type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type PaymentRow = {
    id: string;
    amount: number;
    currency: string;
    payment_method: string;
    license_type: string;
    period_start: string;
    period_end: string | null;
    notes: string | null;
    created_at: string;
    status: string;
    proof_url: string | null;
    denial_message: string | null;
    reviewed_at: string | null;
    submitter: { id: string; name: string | null } | null;
    reviewer: { id: string; name: string | null } | null;
};

const METHOD_META: Record<string, { label: string; icon: LucideIcon }> = {
    cash: { label: 'Cash', icon: Banknote },
    bank_transfer: { label: 'Bank transfer', icon: Landmark },
    card: { label: 'Card', icon: CreditCard },
    online: { label: 'Online', icon: Globe },
    other: { label: 'Other', icon: HelpCircle },
};

const methodMeta = (m: string) => METHOD_META[m] ?? { label: m.replace(/_/g, ' '), icon: HelpCircle };

function licenseLabel(t: string) {
    if (t === 'lifetime') return 'Lifetime';
    if (t === 'yearly') return 'Yearly';
    if (t === 'monthly') return 'Monthly';
    return t;
}

const statusTheme = (status: string) => {
    switch (status) {
        case 'approved':
            return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green', label: 'Approved', icon: CheckCircle2 };
        case 'pending':
            return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange', label: 'Pending', icon: Clock };
        case 'denied':
            return { bg: 'bg-ant-rose/10', border: 'border-ant-rose/25', text: 'text-ant-rose', dot: 'bg-ant-rose', label: 'Denied', icon: XCircle };
        default:
            return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid', label: status, icon: HelpCircle };
    }
};

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const BillingKpi: React.FC<{
    label: string;
    value: string;
    suffix?: string;
    accent: keyof typeof KPI_ACCENTS;
    icon: LucideIcon;
}> = ({ label, value, suffix, accent, icon: Icon }) => {
    const a = KPI_ACCENTS[accent];
    return (
        <div className="bg-ant-paper p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                    <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                    {label}
                </div>
                <div className={cn('h-8 w-8 rounded-lg border flex items-center justify-center', a.tile)}>
                    <Icon className="w-4 h-4" strokeWidth={1.75} />
                </div>
            </div>
            <p className="font-display text-[22px] font-semibold text-ant-ink tabular-nums mt-2 truncate">
                {value}
                {suffix ? <span className="text-[12px] text-ant-mid font-normal ml-1.5">{suffix}</span> : null}
            </p>
        </div>
    );
};

const HeaderShell = () => (
    <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
            Business · Billing
        </div>
        <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
            Billing
        </h1>
        <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
            Every workspace payment, every renewal, every receipt — a ledger of how the platform stays on.
        </p>
    </header>
);

const BusinessPayments = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const [proofFor, setProofFor] = useState<PaymentRow | null>(null);
    const [signedUrl, setSignedUrl] = useState<string | null>(null);
    const [proofLoading, setProofLoading] = useState(false);

    const { data: payments, isLoading, isError } = useQuery({
        queryKey: ['business-payments', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await supabase
                .from('business_payments')
                .select(
                    `
          *,
          submitter:users!business_payments_submitted_by_fkey(id, name),
          reviewer:users!business_payments_reviewed_by_fkey(id, name)
        `
                )
                .eq('business_id', activeBusinessId)
                .order('created_at', { ascending: false });
            if (error) throw error;
            return (data ?? []) as PaymentRow[];
        },
        enabled: !!activeBusinessId,
    });

    const stats = useMemo(() => {
        if (!payments?.length) {
            return { total: 0, approvedSum: 0, deniedCount: 0, currency: 'MAD', byStatus: {} as Record<string, number> };
        }
        const currency = payments[0]?.currency || 'MAD';
        let approvedSum = 0;
        let deniedCount = 0;
        const byStatus: Record<string, number> = {};
        for (const p of payments) {
            byStatus[p.status] = (byStatus[p.status] || 0) + 1;
            if (p.status === 'approved') approvedSum += Number(p.amount);
            if (p.status === 'denied') deniedCount += 1;
        }
        return { total: payments.length, approvedSum, deniedCount, currency, byStatus };
    }, [payments]);

    const openProof = async (p: PaymentRow) => {
        setProofFor(p);
        setSignedUrl(null);
        if (!p.proof_url) return;
        setProofLoading(true);
        try {
            const { data } = await supabase.storage.from('payment-proofs').createSignedUrl(p.proof_url, 300);
            setSignedUrl(data?.signedUrl ?? null);
        } finally {
            setProofLoading(false);
        }
    };

    if (!activeBusinessId) {
        return (
            <div className="ant-surface min-h-screen">
                <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                    <HeaderShell />
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper p-16 text-center">
                        <p className="font-serif italic text-[13px] text-ant-mid">No active business selected.</p>
                    </div>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="ant-surface min-h-screen">
                <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                    <HeaderShell />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <div key={i} className="bg-ant-paper p-4"><Skeleton className="h-12 rounded-lg" /></div>
                        ))}
                    </div>
                    <Skeleton className="h-96 rounded-2xl" />
                </div>
            </div>
        );
    }

    if (isError) {
        return (
            <div className="ant-surface min-h-screen">
                <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                    <HeaderShell />
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper p-16 text-center">
                        <p className="font-serif italic text-[13px] text-ant-mid">Could not load payments.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="ant-surface min-h-screen">
            <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                <HeaderShell />

                {/* KPI strip */}
                <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                    <BillingKpi label="Recorded" value={String(stats.total)} suffix="submissions" accent="ink" icon={Receipt} />
                    <BillingKpi
                        label="Approved total"
                        value={stats.approvedSum.toLocaleString()}
                        suffix={stats.currency}
                        accent="green"
                        icon={CheckCircle2}
                    />
                    <BillingKpi label="In review" value={String(stats.byStatus.pending ?? 0)} suffix="pending" accent="orange" icon={Clock} />
                    <BillingKpi label="Denied" value={String(stats.deniedCount)} suffix="events" accent="rose" icon={XCircle} />
                </section>

                {!payments?.length ? (
                    <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                        <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                            <Receipt className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                        </div>
                        <h3 className="font-display text-[18px] text-ant-ink tracking-tight">No payments yet</h3>
                        <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                            Your first billing submission will appear here — with proof, status, and the whole paper trail.
                        </p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-ant-line bg-ant-light/50">
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">#</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Submitted</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Amount</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Method</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">License</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Period</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Status</th>
                                        <th className="px-4 py-3 text-left text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Submitted by</th>
                                        <th className="px-4 py-3 text-right text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid"></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payments.map((p, i) => {
                                        const s = statusTheme(p.status);
                                        const StatusIcon = s.icon;
                                        const m = methodMeta(p.payment_method);
                                        const MethodIcon = m.icon;
                                        return (
                                            <tr
                                                key={p.id}
                                                className="border-b border-ant-line last:border-0 hover:bg-ant-light/60 transition-colors tabular-nums"
                                            >
                                                <td className="px-4 py-3 text-[11px] text-ant-mid font-semibold tabular-nums">
                                                    {String(i + 1).padStart(2, '0')}
                                                </td>
                                                <td className="px-4 py-3 whitespace-nowrap">
                                                    <div className="text-[12px] font-semibold text-ant-ink tabular-nums">
                                                        {format(parseISO(p.created_at), 'MMM d, yyyy')}
                                                    </div>
                                                    <div className="text-[10px] text-ant-mid tabular-nums">
                                                        {format(parseISO(p.created_at), 'HH:mm')}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-3 text-right whitespace-nowrap">
                                                    <span className="font-display text-[14px] font-semibold text-ant-ink tabular-nums">
                                                        {Number(p.amount).toLocaleString()}
                                                        <span className="text-[10px] text-ant-mid font-normal ml-1">{p.currency}</span>
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink capitalize">
                                                        <MethodIcon className="w-3 h-3 text-ant-mid" />
                                                        {m.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-paper px-2 py-0.5 text-[10px] font-semibold text-ant-ink uppercase tracking-[0.12em]">
                                                        {licenseLabel(p.license_type)}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-[11px] text-ant-mid whitespace-nowrap">
                                                    {p.period_end
                                                        ? `${format(parseISO(p.period_start), 'MMM d')} → ${format(parseISO(p.period_end), 'MMM d, yyyy')}`
                                                        : p.license_type !== 'lifetime'
                                                        ? `From ${format(parseISO(p.period_start), 'MMM d, yyyy')}`
                                                        : '—'}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', s.bg, s.border, s.text)}>
                                                        <StatusIcon className="w-3 h-3" />
                                                        {s.label}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="text-[12px] font-semibold text-ant-ink truncate max-w-[160px]">
                                                        {p.submitter?.name || '—'}
                                                    </div>
                                                    {p.reviewer?.name && p.reviewed_at && (
                                                        <div className="text-[10px] text-ant-mid truncate max-w-[160px] font-serif italic">
                                                            rev. {p.reviewer.name}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-1.5 justify-end">
                                                        {p.notes && (
                                                            <span
                                                                className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] text-ant-mid max-w-[140px] truncate"
                                                                title={p.notes}
                                                            >
                                                                {p.notes}
                                                            </span>
                                                        )}
                                                        {p.status === 'denied' && p.denial_message && (
                                                            <span
                                                                className="inline-flex items-center rounded-full border border-ant-rose/25 bg-ant-rose/10 px-2 py-0.5 text-[10px] font-semibold text-ant-rose max-w-[140px] truncate"
                                                                title={p.denial_message}
                                                            >
                                                                {p.denial_message}
                                                            </span>
                                                        )}
                                                        {p.proof_url && (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 rounded-full px-3 text-[11px] font-semibold text-ant-ink hover:bg-ant-light gap-1.5 border border-ant-line cursor-pointer"
                                                                onClick={() => openProof(p)}
                                                            >
                                                                <FileImage className="w-3 h-3" />
                                                                Proof
                                                                <ChevronRight className="w-3 h-3 text-ant-mid" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                <Dialog open={!!proofFor} onOpenChange={(o) => !o && setProofFor(null)}>
                    <DialogContent className="max-w-lg p-0 border border-ant-line bg-ant-paper rounded-2xl shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)] overflow-hidden">
                        <DialogHeader className="px-6 pt-6 pb-4 border-b border-ant-line space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Payment · Proof
                            </div>
                            <DialogTitle className="font-display text-[20px] leading-tight tracking-tight text-ant-ink">
                                {proofFor ? `${Number(proofFor.amount).toLocaleString()} ${proofFor.currency}` : 'Payment proof'}
                            </DialogTitle>
                            <DialogDescription className="font-serif italic text-[13px] text-ant-mid">
                                {proofFor
                                    ? `${methodMeta(proofFor.payment_method).label} · ${format(parseISO(proofFor.created_at), 'MMM d, yyyy · HH:mm')}`
                                    : 'Receipt attached to this submission.'}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="p-6 space-y-3">
                            <div className="relative rounded-2xl overflow-hidden bg-ant-light border border-ant-line min-h-[240px] flex items-center justify-center">
                                {proofLoading && <Loader2 className="w-6 h-6 animate-spin text-ant-orange" />}
                                {!proofLoading && signedUrl && (
                                    <img src={signedUrl} alt="Payment proof" className="max-h-[60vh] w-full object-contain" />
                                )}
                                {!proofLoading && !signedUrl && proofFor?.proof_url && (
                                    <p className="font-serif italic text-[12px] text-ant-mid p-6">Could not load file.</p>
                                )}
                            </div>
                            <div className="flex items-center justify-between gap-2">
                                {signedUrl && (
                                    <Button asChild variant="outline" className="h-10 px-4 rounded-full border-ant-line bg-ant-paper text-ant-ink hover:bg-ant-light text-[12px] font-semibold gap-2 cursor-pointer">
                                        <a href={signedUrl} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="w-3.5 h-3.5" />
                                            Open full size
                                        </a>
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    onClick={() => setProofFor(null)}
                                    className="h-10 px-5 rounded-full text-[12px] font-semibold text-ant-mid hover:text-ant-ink hover:bg-ant-light gap-2 cursor-pointer ml-auto"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    Close
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
};

export default BusinessPayments;
