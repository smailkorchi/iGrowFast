import React, { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format, parseISO } from 'date-fns';
import {
    Wallet,
    DollarSign,
    PackageCheck,
    Clock,
    CheckCircle2,
    Loader2,
    Megaphone,
    CreditCard,
    Calendar,
    TrendingUp,
    Info,
    Lock,
    Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useCurrentUserId } from '@/hooks/useCurrentUserId';
import { useMediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { fmtCur, fmtCurFull, fmtNum } from '@/lib/formatNumbers';

type Payout = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    payment_type: 'commission' | 'salary';
    salary_earned: number | string;
    commission_earned: number | string;
    total_amount: number | string;
    delivered_orders: number;
    total_spend: number | string;
    campaigns_count: number;
    bank_snapshot: any;
    status: 'pending' | 'paid';
    created_at: string;
    paid_at: string | null;
};

type UserProfile = {
    id: string;
    name: string;
    payment_type: 'commission' | 'salary' | null;
    commission_price: number | null;
    salary_amount: number | null;
    bank_name: string | null;
    bank_account_holder: string | null;
    bank_rib: string | null;
    cin_number: string | null;
};

const Payments: React.FC = () => {
    const currentUserId = useCurrentUserId();
    const currentMonth = useMemo(() => format(new Date(), 'yyyy-MM'), []);

    const { data: profile } = useQuery<UserProfile | null>({
        queryKey: ['mb-payments-profile', currentUserId],
        queryFn: async () => {
            if (!currentUserId) return null;
            const { data } = await (supabase as any)
                .from('users')
                .select('id, name, payment_type, commission_price, salary_amount, bank_name, bank_account_holder, bank_rib, cin_number')
                .eq('id', currentUserId)
                .single();
            return (data || null) as UserProfile | null;
        },
        enabled: !!currentUserId,
    });

    const { data: payouts = [], isLoading: loadingPayouts } = useQuery<Payout[]>({
        queryKey: ['mb-payments-list', currentUserId],
        queryFn: async () => {
            if (!currentUserId) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('*')
                .eq('mediabuyer_id', currentUserId)
                .order('payout_month', { ascending: false });
            if (error) throw error;
            return (data || []) as Payout[];
        },
        enabled: !!currentUserId,
    });

    const { rows: allRows, isLoading: loadingEarnings } = useMediaBuyerEarnings(currentMonth);
    const myEarnings = useMemo(() => allRows.find((r) => r.mediabuyer_id === currentUserId) || null, [allRows, currentUserId]);

    const stats = useMemo(() => {
        let totalPaid = 0;
        let totalPending = 0;
        let lifetime = 0;
        for (const p of payouts) {
            const amt = Number(p.total_amount || 0);
            lifetime += amt;
            if (p.status === 'paid') totalPaid += amt;
            else totalPending += amt;
        }
        return { totalPaid, totalPending, lifetime };
    }, [payouts]);

    const paymentType = profile?.payment_type || 'commission';

    return (
        <div className="mx-auto max-w-[1440px] px-3 md:px-5 py-3.5 space-y-3">
            {/* Header */}
            <header className="space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <h1 className="text-[15px] font-semibold text-brand-navy tracking-tight leading-none">Payments</h1>
                        <p className="text-[9px] text-gray-400 uppercase tracking-[0.18em] mt-1">
                            Your earnings, payouts and bank details
                        </p>
                    </div>
                    <Badge
                        className={cn(
                            'h-6 px-2.5 text-[9px] font-semibold uppercase tracking-wider border-none',
                            paymentType === 'commission' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-brand-navy/10 text-brand-navy'
                        )}
                    >
                        {paymentType === 'commission'
                            ? `Commission · ${fmtCur(Number(profile?.commission_price || 0))} / delivered`
                            : `Salary · ${fmtCur(Number(profile?.salary_amount || 0))} / month`}
                    </Badge>
                </div>
            </header>

            {/* Current month preview */}
            <div className="rounded-xl border border-gray-100 bg-white p-3.5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
                    <div>
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">This month · {format(new Date(), 'MMMM yyyy')}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">Accrual so far. Final payout generated by admin at month-end.</p>
                    </div>
                    <div className="text-right">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">To be paid</p>
                        {loadingEarnings ? (
                            <Skeleton className="h-8 w-28 ml-auto mt-1" />
                        ) : (
                            <p className="text-[22px] font-semibold tabular-nums text-brand-navy mt-0.5" title={fmtCurFull(myEarnings?.remaining_amount || 0)}>
                                {fmtCur(myEarnings?.remaining_amount || 0)}
                            </p>
                        )}
                    </div>
                </div>
                {loadingEarnings ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-16 rounded-lg" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <PreviewCell label="Total spend" value={fmtCur(myEarnings?.total_spend || 0)} valueTitle={fmtCurFull(myEarnings?.total_spend || 0)} accent="#ef4444" />
                        <PreviewCell label="Delivered" value={fmtNum(myEarnings?.delivered_orders || 0)} accent="#059669" />
                        <PreviewCell label="Campaigns" value={fmtNum(myEarnings?.campaigns_count || 0)} accent="#3b5e5e" />
                        {paymentType === 'commission' ? (
                            <PreviewCell
                                label="Commission earned"
                                value={fmtCur(myEarnings?.commission_earned || 0)}
                                valueTitle={fmtCurFull(myEarnings?.commission_earned || 0)}
                                accent="#059669"
                            />
                        ) : (
                            <PreviewCell
                                label="Fixed salary"
                                value={fmtCur(myEarnings?.salary_earned || 0)}
                                valueTitle={fmtCurFull(myEarnings?.salary_earned || 0)}
                                accent="#3b5e5e"
                            />
                        )}
                    </div>
                )}
                {myEarnings && myEarnings.prior_paid_amount > 0 && (
                    <div className="mt-3 rounded-lg bg-gray-50 border border-gray-100 p-2.5 flex items-start gap-2 text-[10px] text-gray-500">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
                        <span>
                            {fmtCurFull(myEarnings.prior_paid_amount)} already paid for this month ({fmtCurFull(myEarnings.total_amount)} earned total).
                        </span>
                    </div>
                )}
            </div>

            {/* Lifetime stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full bg-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Total received</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none" title={fmtCurFull(stats.totalPaid)}>{fmtCur(stats.totalPaid)}</p>
                    </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full bg-amber-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Pending</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none" title={fmtCurFull(stats.totalPending)}>{fmtCur(stats.totalPending)}</p>
                    </div>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white p-3 flex items-start gap-2.5">
                    <span className="w-[3px] self-stretch rounded-full bg-brand-navy shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Lifetime earnings</p>
                        <p className="text-[18px] font-semibold tabular-nums text-brand-navy mt-1 leading-none" title={fmtCurFull(stats.lifetime)}>{fmtCur(stats.lifetime)}</p>
                    </div>
                </div>
            </div>

            {/* Payout history */}
            <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                <div className="px-3.5 py-3 border-b border-gray-100">
                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Payout history</p>
                </div>
                {loadingPayouts ? (
                    <div className="p-8 flex justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                    </div>
                ) : payouts.length === 0 ? (
                    <div className="py-8 text-center text-[11px] text-gray-400">No payouts yet. Your first payout will appear here once admin generates it.</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Month</th>
                                    <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Type</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Delivered</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Spend</th>
                                    <th className="text-right px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Amount</th>
                                    <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Status</th>
                                    <th className="text-left px-3 py-2 text-[9px] uppercase tracking-[0.18em] text-gray-400">Paid on</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payouts.map((p) => (
                                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                        <td className="px-3 py-2">
                                            <div className="flex items-center gap-1.5">
                                                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                                                <span className="text-[11px] font-semibold text-brand-navy/80">{format(parseISO(p.payout_month + '-01'), 'MMMM yyyy')}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Badge className={cn('h-5 px-1.5 text-[9px] font-semibold uppercase border-none', p.payment_type === 'commission' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-brand-navy/10 text-brand-navy')}>
                                                {p.payment_type}
                                            </Badge>
                                        </td>
                                        <td className="text-right px-3 py-2 text-[11px] text-emerald-600 tabular-nums">{fmtNum(p.delivered_orders)}</td>
                                        <td className="text-right px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums" title={fmtCurFull(Number(p.total_spend))}>{fmtCur(Number(p.total_spend))}</td>
                                        <td className="text-right px-3 py-2 text-[11px] font-semibold text-brand-navy tabular-nums" title={fmtCurFull(Number(p.total_amount))}>{fmtCur(Number(p.total_amount))}</td>
                                        <td className="px-3 py-2">
                                            <Badge className={cn('h-5 px-1.5 text-[9px] font-semibold uppercase border-none', p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700')}>
                                                {p.status}
                                            </Badge>
                                        </td>
                                        <td className="px-3 py-2 text-[11px] text-brand-navy/80 tabular-nums">
                                            {p.paid_at ? format(new Date(p.paid_at), 'dd MMM yyyy') : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Bank details */}
            <BankDetailsCard profile={profile} currentUserId={currentUserId} />
        </div>
    );
};

// ─── Bank details card ────────────────────────────────────────────
const BankDetailsCard: React.FC<{ profile: UserProfile | null | undefined; currentUserId: string | null }> = ({ profile, currentUserId }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [draft, setDraft] = useState({
        bank_name: '',
        bank_account_holder: '',
        bank_rib: '',
        cin_number: '',
    });

    useEffect(() => {
        setDraft({
            bank_name: profile?.bank_name || '',
            bank_account_holder: profile?.bank_account_holder || '',
            bank_rib: profile?.bank_rib || '',
            cin_number: profile?.cin_number || '',
        });
    }, [profile?.bank_name, profile?.bank_account_holder, profile?.bank_rib, profile?.cin_number]);

    const lock = {
        bank_name: !!profile?.bank_name,
        bank_account_holder: !!profile?.bank_account_holder,
        bank_rib: !!profile?.bank_rib,
        cin_number: !!profile?.cin_number,
    };

    const anyEditable = !lock.bank_name || !lock.bank_account_holder || !lock.bank_rib || !lock.cin_number;
    const allLocked = lock.bank_name && lock.bank_account_holder && lock.bank_rib && lock.cin_number;

    const hasDirtyChanges = useMemo(() => {
        if (!lock.bank_name && draft.bank_name.trim() !== (profile?.bank_name || '')) return true;
        if (!lock.bank_account_holder && draft.bank_account_holder.trim() !== (profile?.bank_account_holder || '')) return true;
        if (!lock.bank_rib && draft.bank_rib.trim() !== (profile?.bank_rib || '')) return true;
        if (!lock.cin_number && draft.cin_number.trim() !== (profile?.cin_number || '')) return true;
        return false;
    }, [draft, profile, lock]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!currentUserId) throw new Error('Not signed in');
            const patch: Record<string, string> = {};
            if (!lock.bank_name && draft.bank_name.trim()) patch.bank_name = draft.bank_name.trim();
            if (!lock.bank_account_holder && draft.bank_account_holder.trim()) patch.bank_account_holder = draft.bank_account_holder.trim();
            if (!lock.bank_rib && draft.bank_rib.trim()) patch.bank_rib = draft.bank_rib.trim();
            if (!lock.cin_number && draft.cin_number.trim()) patch.cin_number = draft.cin_number.trim();

            if (Object.keys(patch).length === 0) throw new Error('Nothing to save');

            const { error } = await (supabase as any).from('users').update(patch).eq('id', currentUserId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['mb-payments-profile'] });
            toast({ title: 'Bank details saved', description: 'Saved fields are now locked. Contact an admin to change them.' });
        },
        onError: (err: any) => toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
    });

    return (
        <div className="rounded-xl border border-gray-100 bg-white p-3.5">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <CreditCard className="w-3.5 h-3.5 text-gray-400" />
                    <p className="text-[9px] uppercase tracking-[0.18em] font-bold text-gray-400">Bank details</p>
                </div>
                {allLocked && (
                    <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">
                        <Lock className="w-3 h-3" />
                        Locked
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                <EditableBankField
                    label="Bank"
                    value={draft.bank_name}
                    onChange={(v) => setDraft((d) => ({ ...d, bank_name: v }))}
                    locked={lock.bank_name}
                    placeholder="e.g. Attijariwafa Bank"
                />
                <EditableBankField
                    label="Account holder"
                    value={draft.bank_account_holder}
                    onChange={(v) => setDraft((d) => ({ ...d, bank_account_holder: v }))}
                    locked={lock.bank_account_holder}
                    placeholder="Full legal name"
                />
                <EditableBankField
                    label="RIB"
                    value={draft.bank_rib}
                    onChange={(v) => setDraft((d) => ({ ...d, bank_rib: v }))}
                    locked={lock.bank_rib}
                    placeholder="24 digits"
                    mono
                />
                <EditableBankField
                    label="CIN"
                    value={draft.cin_number}
                    onChange={(v) => setDraft((d) => ({ ...d, cin_number: v }))}
                    locked={lock.cin_number}
                    placeholder="ID card number"
                />
            </div>

            {anyEditable && (
                <div className="mt-3 flex items-center justify-between gap-4">
                    <p className="text-[10px] text-gray-400 leading-snug max-w-md">
                        Once saved, these fields are locked. To change them later, contact an admin.
                    </p>
                    <Button
                        onClick={() => saveMutation.mutate()}
                        disabled={!hasDirtyChanges || saveMutation.isPending}
                        className="h-8 rounded-md text-[11px] font-semibold bg-brand-navy hover:bg-brand-navy/90 text-white gap-1.5"
                    >
                        {saveMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Save
                    </Button>
                </div>
            )}

            {!allLocked && (
                <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 flex items-start gap-2 text-[10px] text-amber-800">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Your bank details are incomplete. Admin needs this information to pay you.</span>
                </div>
            )}
        </div>
    );
};

const EditableBankField: React.FC<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    locked: boolean;
    placeholder?: string;
    mono?: boolean;
}> = ({ label, value, onChange, locked, placeholder, mono }) => (
    <div className={cn('rounded-lg p-3 border', locked ? 'bg-gray-50 border-gray-100' : 'bg-white border-gray-100')}>
        <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">{label}</p>
            {locked && <Lock className="w-2.5 h-2.5 text-gray-300" />}
        </div>
        {locked ? (
            <p className={cn('text-[11px] font-semibold text-brand-navy break-all', mono && 'font-mono')}>{value || '—'}</p>
        ) : (
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={cn(
                    'h-8 rounded border-gray-100 bg-gray-50 text-[11px] font-semibold text-brand-navy placeholder:text-gray-400',
                    mono && 'font-mono'
                )}
            />
        )}
    </div>
);

const PreviewCell: React.FC<{ label: string; value: string; valueTitle?: string; accent: string }> = ({
    label,
    value,
    valueTitle,
    accent,
}) => (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5 flex items-start gap-2">
        <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ background: accent }} />
        <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-gray-400">{label}</p>
            <p className="text-[14px] font-semibold tabular-nums text-brand-navy mt-0.5 leading-none" title={valueTitle || value}>{value}</p>
        </div>
    </div>
);

export default Payments;
