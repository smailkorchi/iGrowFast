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
import { Card, CardContent } from '@/components/ui/card';
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

const STATUS: Record<string, { label: string; class: string }> = {
  pending: {
    label: 'Pending',
    class: 'bg-amber-50 text-amber-800 border-amber-100',
  },
  approved: {
    label: 'Approved',
    class: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  },
  denied: {
    label: 'Denied',
    class: 'bg-red-50 text-red-800 border-red-100',
  },
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
      <div className="space-y-8 pb-8">
        <PaymentsHeader />
        <Card className="border-0 shadow-sm rounded-3xl bg-white">
          <CardContent className="p-12 text-center">
            <p className="text-sm text-gray-400 font-light">No active business selected.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-8 pb-8">
        <PaymentsHeader />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
          <Skeleton className="h-24 rounded-3xl" />
        </div>
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-8 pb-8">
        <PaymentsHeader />
        <Card className="border-0 shadow-sm rounded-3xl bg-white">
          <CardContent className="p-12 text-center">
            <p className="text-sm text-gray-500 font-light">Could not load payments.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
        <div className="relative p-8 flex flex-col lg:flex-row lg:items-end justify-between gap-8">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-2">Payments</p>
            <h1 className="text-3xl sm:text-4xl font-extralight text-gray-900 tracking-tight mb-2">
              Billing history
            </h1>
            <p className="text-gray-500 font-light text-sm max-w-md">
              Submissions and renewals for your workspace, in one calm timeline.
            </p>
          </div>
          <div className="hidden sm:flex w-14 h-14 rounded-2xl bg-primary/10 items-center justify-center shrink-0">
            <Wallet className="w-7 h-7 text-primary/80" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label="Recorded payments"
          value={String(stats.total)}
          hint="All submissions"
        />
        <StatTile
          label="Approved total"
          value={`${stats.approvedSum.toLocaleString()} ${stats.currency}`}
          hint="Successful charges"
        />
        <StatTile
          label="In review"
          value={String(stats.byStatus.pending ?? 0)}
          hint="Awaiting platform"
        />
      </div>

      {!payments?.length ? (
        <Card className="border-0 shadow-sm rounded-3xl bg-white">
          <CardContent className="p-16 text-center">
            <Receipt className="w-10 h-10 text-gray-200 mx-auto mb-4" />
            <p className="text-sm text-gray-400 font-light">No payments yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {payments.map((p, i) => {
            const st = STATUS[p.status] ?? {
              label: p.status,
              class: 'bg-gray-50 text-gray-700 border-gray-100',
            };
            return (
              <Card
                key={p.id}
                className="border-0 shadow-sm rounded-3xl bg-white overflow-hidden transition-shadow hover:shadow-md"
              >
                <CardContent className="p-0">
                  <div className="flex flex-col lg:flex-row lg:items-stretch">
                    <div className="lg:w-[220px] px-6 py-5 bg-gradient-to-br from-gray-50/80 to-transparent border-b lg:border-b-0 lg:border-r border-gray-100 flex flex-col justify-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                        Amount
                      </p>
                      <p className="text-2xl font-extralight text-gray-900 tabular-nums">
                        {Number(p.amount).toLocaleString()}{' '}
                        <span className="text-sm font-medium text-gray-400">{p.currency}</span>
                      </p>
                      <Badge
                        variant="outline"
                        className={cn('mt-3 w-fit rounded-full text-[10px] font-bold uppercase border', st.class)}
                      >
                        {st.label}
                      </Badge>
                    </div>
                    <div className="flex-1 px-6 py-5 flex flex-col justify-center gap-3">
                      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500 font-light">
                        <span>
                          <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px] mr-2">
                            Submitted
                          </span>
                          {format(parseISO(p.created_at), 'MMM d, yyyy · HH:mm')}
                        </span>
                        <span>
                          <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px] mr-2">
                            Method
                          </span>
                          {methodLabel(p.payment_method)}
                        </span>
                        <span>
                          <span className="text-gray-400 font-bold uppercase tracking-wider text-[10px] mr-2">
                            License
                          </span>
                          {licenseLabel(p.license_type)}
                        </span>
                      </div>
                      {p.period_end && (
                        <p className="text-xs text-gray-400 font-light">
                          Period: {format(parseISO(p.period_start), 'MMM d, yyyy')} —{' '}
                          {format(parseISO(p.period_end), 'MMM d, yyyy')}
                        </p>
                      )}
                      {!p.period_end && p.license_type !== 'lifetime' && (
                        <p className="text-xs text-gray-400 font-light">
                          From {format(parseISO(p.period_start), 'MMM d, yyyy')}
                        </p>
                      )}
                      {p.submitter?.name && (
                        <p className="text-xs text-gray-400">
                          By <span className="text-gray-600 font-medium">{p.submitter.name}</span>
                        </p>
                      )}
                      {p.notes && (
                        <p className="text-xs text-gray-500 font-light line-clamp-2 border-l-2 border-primary/20 pl-3">
                          {p.notes}
                        </p>
                      )}
                      {p.status === 'denied' && p.denial_message && (
                        <p className="text-xs text-red-600/90 font-light">{p.denial_message}</p>
                      )}
                      {p.reviewer?.name && p.reviewed_at && (
                        <p className="text-[10px] uppercase tracking-wider text-gray-400">
                          Reviewed by {p.reviewer.name} · {format(parseISO(p.reviewed_at), 'MMM d, yyyy')}
                        </p>
                      )}
                      {p.proof_url && (
                        <div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-9 px-3 rounded-xl text-xs font-bold gap-1 text-primary hover:text-primary hover:bg-primary/5 -ml-3"
                            onClick={() => openProof(p)}
                          >
                            <FileImage className="w-3.5 h-3.5" />
                            Proof
                            <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="hidden xl:flex w-12 items-center justify-center border-l border-gray-50 text-[10px] font-bold text-gray-300">
                      {String(i + 1).padStart(2, '0')}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!proofFor} onOpenChange={(o) => !o && setProofFor(null)}>
        <DialogContent className="sm:max-w-lg rounded-3xl border-0 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="font-light text-xl">Payment proof</DialogTitle>
          </DialogHeader>
          <div className="relative rounded-2xl overflow-hidden bg-gray-50 min-h-[200px] flex items-center justify-center">
            {proofLoading && <Loader2 className="w-8 h-8 animate-spin text-primary/40" />}
            {!proofLoading && signedUrl && (
              <img src={signedUrl} alt="Payment proof" className="max-h-[70vh] w-full object-contain" />
            )}
            {!proofLoading && !signedUrl && proofFor?.proof_url && (
              <p className="text-sm text-gray-400 p-6">Could not load file.</p>
            )}
          </div>
          <Button variant="ghost" size="sm" className="rounded-xl gap-2" onClick={() => setProofFor(null)}>
            <X className="w-4 h-4" />
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="border-0 shadow-sm rounded-3xl bg-white">
      <CardContent className="p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">{label}</p>
        <p className="text-xl font-light text-gray-900 tabular-nums">{value}</p>
        <p className="text-[10px] text-gray-400 mt-2 font-light">{hint}</p>
      </CardContent>
    </Card>
  );
}

function PaymentsHeader() {
  return (
    <div className="relative">
      <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
      <div className="relative p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Payments</h1>
            <p className="text-gray-500 font-light">Business payments and billing</p>
          </div>
          <div className="hidden sm:flex w-12 h-12 rounded-2xl bg-primary/10 items-center justify-center">
            <Wallet className="w-6 h-6 text-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default BusinessPayments;
