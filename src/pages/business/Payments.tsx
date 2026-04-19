import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  Wallet,
  Loader2,
  Receipt,
  ChevronRight,
  FileImage,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
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

const STATUS_ACCENT: Record<string, string> = {
  pending: '#d97706',
  approved: '#059669',
  denied: '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  card: 'Card',
  online: 'Online',
  other: 'Other',
};

function methodLabel(m: string) {
  return METHOD_LABEL[m] ?? m.replace(/_/g, ' ');
}

function licenseLabel(t: string) {
  if (t === 'lifetime') return 'Lifetime';
  if (t === 'yearly') return 'Yearly';
  if (t === 'monthly') return 'Monthly';
  return t;
}

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
      return { total: 0, approvedSum: 0, currency: 'MAD', byStatus: {} as Record<string, number> };
    }
    const currency = payments[0]?.currency || 'MAD';
    let approvedSum = 0;
    const byStatus: Record<string, number> = {};
    for (const p of payments) {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1;
      if (p.status === 'approved') approvedSum += Number(p.amount);
    }
    return { total: payments.length, approvedSum, currency, byStatus };
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
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        <PaymentsHeader />
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
          <p className="text-[11px] text-gray-400">No active business selected.</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        <PaymentsHeader />
        <div className="grid gap-2 sm:grid-cols-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
        <PaymentsHeader />
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
          <p className="text-[11px] text-gray-500">Could not load payments.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
      {/* Header */}
      <header className="space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Billing History</h1>
            <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Submissions and renewals for your workspace</p>
          </div>
        </div>
      </header>

      {/* KPI tiles */}
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: 'Recorded payments', value: String(stats.total), hint: 'All submissions', accent: '#3b5e5e' },
          { label: 'Approved total', value: `${stats.approvedSum.toLocaleString()} ${stats.currency}`, hint: 'Successful charges', accent: '#059669' },
          { label: 'In review', value: String(stats.byStatus.pending ?? 0), hint: 'Awaiting platform', accent: '#d97706' },
        ].map((stat, i) => (
          <div key={i} className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
            <span className="w-[3px] self-stretch rounded-full" style={{ background: stat.accent }} />
            <div className="flex-1 min-w-0">
              <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">{stat.label}</p>
              <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1">{stat.value}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">{stat.hint}</p>
            </div>
          </div>
        ))}
      </div>

      {!payments?.length ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
          <Receipt className="w-6 h-6 text-gray-200 mx-auto mb-3" />
          <p className="text-[11px] text-gray-400">No payments yet.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-gray-100">
              <tr>
                {['#', 'Submitted', 'Amount', 'Method', 'License', 'Period', 'Status', 'Submitted by', ''].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[9px] uppercase tracking-[0.18em] text-gray-400 font-bold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => {
                const accent = STATUS_ACCENT[p.status] ?? '#9ca3af';
                const label = STATUS_LABEL[p.status] ?? p.status;
                return (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                    <td className="px-3 py-2 text-[10px] text-gray-400 tabular-nums">{String(i + 1).padStart(2, '0')}</td>
                    <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums whitespace-nowrap">
                      {format(parseISO(p.created_at), 'MMM d, yyyy')}
                      <span className="block text-[9px] text-gray-400">{format(parseISO(p.created_at), 'HH:mm')}</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] font-semibold text-brand-navy tabular-nums whitespace-nowrap">
                      {Number(p.amount).toLocaleString()} <span className="text-[9px] text-gray-400 font-normal">{p.currency}</span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-brand-navy/80">{methodLabel(p.payment_method)}</td>
                    <td className="px-3 py-2 text-[11px] text-brand-navy/80">{licenseLabel(p.license_type)}</td>
                    <td className="px-3 py-2 text-[11px] text-brand-navy/80 whitespace-nowrap">
                      {p.period_end
                        ? `${format(parseISO(p.period_start), 'MMM d')} → ${format(parseISO(p.period_end), 'MMM d, yyyy')}`
                        : p.license_type !== 'lifetime'
                        ? `From ${format(parseISO(p.period_start), 'MMM d, yyyy')}`
                        : '—'
                      }
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold"
                        style={{ background: `${accent}18`, color: accent }}
                      >
                        {label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[10px] text-gray-500">
                      {p.submitter?.name || '—'}
                      {p.reviewer?.name && p.reviewed_at && (
                        <span className="block text-[9px] text-gray-400">
                          Rev. {p.reviewer.name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {p.notes && (
                          <span className="h-5 px-1.5 inline-flex items-center rounded text-[9px] text-gray-500 bg-gray-100 max-w-[120px] truncate" title={p.notes}>
                            {p.notes}
                          </span>
                        )}
                        {p.status === 'denied' && p.denial_message && (
                          <span className="h-5 px-1.5 inline-flex items-center rounded text-[9px] font-semibold bg-red-50 text-red-700 max-w-[120px] truncate" title={p.denial_message}>
                            {p.denial_message}
                          </span>
                        )}
                        {p.proof_url && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 rounded text-[9px] font-semibold gap-1 text-brand-navy/60 hover:text-brand-navy hover:bg-gray-100"
                            onClick={() => openProof(p)}
                          >
                            <FileImage className="w-3 h-3" />
                            Proof
                            <ChevronRight className="w-3 h-3 opacity-50" />
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
      )}

      <Dialog open={!!proofFor} onOpenChange={(o) => !o && setProofFor(null)}>
        <DialogContent className="sm:max-w-lg rounded-xl border border-gray-100 shadow-lg">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-semibold text-brand-navy">Payment proof</DialogTitle>
          </DialogHeader>
          <div className="relative rounded-xl overflow-hidden bg-gray-50 min-h-[180px] flex items-center justify-center">
            {proofLoading && <Loader2 className="w-5 h-5 animate-spin text-brand-navy/40" />}
            {!proofLoading && signedUrl && (
              <img src={signedUrl} alt="Payment proof" className="max-h-[65vh] w-full object-contain" />
            )}
            {!proofLoading && !signedUrl && proofFor?.proof_url && (
              <p className="text-[11px] text-gray-400 p-6">Could not load file.</p>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-8 rounded-md text-[11px] font-semibold gap-1.5" onClick={() => setProofFor(null)}>
            <X className="w-3.5 h-3.5" />
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function PaymentsHeader() {
  return (
    <header className="space-y-2.5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Billing History</h1>
          <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">Submissions and renewals for your workspace</p>
        </div>
      </div>
    </header>
  );
}

export default BusinessPayments;
