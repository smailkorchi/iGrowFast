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
import { Card, CardContent } from '@/components/ui/card';
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

    // Profile (bank details + payment type).
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

    // All payouts ever for this media buyer.
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

    // Current month preview (what the user would be paid if admin generated today).
    // We filter the business-wide earnings to just this user.
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
        <div className="space-y-8 animate-in fade-in duration-500 pb-12">
            {/* Header */}
            <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl" />
                <div className="relative p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <h1 className="text-4xl font-extralight text-gray-900 mb-2">Payments</h1>
                            <p className="text-gray-500 font-light">Your earnings, payouts and bank details.</p>
                        </div>
                        <Badge
                            className={cn(
                                'rounded-full text-[11px] font-black uppercase tracking-wider px-4 py-2 border-none',
                                paymentType === 'commission' ? 'bg-primary/10 text-primary' : 'bg-indigo-500/10 text-indigo-600'
                            )}
                        >
                            {paymentType === 'commission'
                                ? `Commission · ${fmtCur(Number(profile?.commission_price || 0))} / delivered`
                                : `Salary · ${fmtCur(Number(profile?.salary_amount || 0))} / month`}
                        </Badge>
                    </div>
                </div>
            </div>

            {/* Current month preview card */}
            <Card className="border-none rounded-[32px] bg-gradient-to-br from-primary/5 via-white to-primary/[0.02] shadow-sm overflow-hidden">
                <CardContent className="p-8">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
                        <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary/70 mb-1">This month · {format(new Date(), 'MMMM yyyy')}</p>
                            <p className="text-sm text-brand-navy/60 font-medium">Accrual so far. Final payout is generated by admin at month-end.</p>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black uppercase tracking-widest text-primary/70">To be paid</p>
                            {loadingEarnings ? (
                                <Skeleton className="h-10 w-32 ml-auto mt-1" />
                            ) : (
                                <p className="text-4xl font-black text-brand-navy tabular-nums" title={fmtCurFull(myEarnings?.remaining_amount || 0)}>
                                    {fmtCur(myEarnings?.remaining_amount || 0)}
                                </p>
                            )}
                        </div>
                    </div>
                    {loadingEarnings ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <Skeleton key={i} className="h-20 rounded-2xl bg-white/60" />
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <PreviewCell label="Total spend" value={fmtCur(myEarnings?.total_spend || 0)} valueTitle={fmtCurFull(myEarnings?.total_spend || 0)} icon={DollarSign} tone="text-red-600" />
                            <PreviewCell label="Delivered" value={fmtNum(myEarnings?.delivered_orders || 0)} icon={PackageCheck} tone="text-emerald-600" />
                            <PreviewCell label="Campaigns" value={fmtNum(myEarnings?.campaigns_count || 0)} icon={Megaphone} tone="text-indigo-600" />
                            {paymentType === 'commission' ? (
                                <PreviewCell
                                    label="Commission earned"
                                    value={fmtCur(myEarnings?.commission_earned || 0)}
                                    valueTitle={fmtCurFull(myEarnings?.commission_earned || 0)}
                                    icon={TrendingUp}
                                    tone="text-primary"
                                />
                            ) : (
                                <PreviewCell
                                    label="Fixed salary"
                                    value={fmtCur(myEarnings?.salary_earned || 0)}
                                    valueTitle={fmtCurFull(myEarnings?.salary_earned || 0)}
                                    icon={Wallet}
                                    tone="text-indigo-600"
                                />
                            )}
                        </div>
                    )}
                    {myEarnings && myEarnings.prior_paid_amount > 0 && (
                        <div className="mt-4 rounded-2xl bg-brand-navy/[0.03] border border-brand-navy/5 p-3 flex items-start gap-3 text-xs text-brand-navy/70">
                            <Info className="w-4 h-4 shrink-0 mt-0.5 text-brand-navy/40" />
                            <span>
                                {fmtCurFull(myEarnings.prior_paid_amount)} already paid for this month ({fmtCurFull(myEarnings.total_amount)} earned total).
                            </span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Lifetime stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <StatCard label="Total received" value={fmtCur(stats.totalPaid)} valueTitle={fmtCurFull(stats.totalPaid)} icon={CheckCircle2} tone="bg-emerald-500/10 text-emerald-600" />
                <StatCard label="Pending" value={fmtCur(stats.totalPending)} valueTitle={fmtCurFull(stats.totalPending)} icon={Clock} tone="bg-amber-500/10 text-amber-600" />
                <StatCard label="Lifetime earnings" value={fmtCur(stats.lifetime)} valueTitle={fmtCurFull(stats.lifetime)} icon={Wallet} tone="bg-primary/10 text-primary" />
            </div>

            {/* Payout history */}
            <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur shadow-sm overflow-hidden">
                <CardContent className="p-0">
                    <div className="p-6 pb-4">
                        <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Payout history</h2>
                    </div>
                    {loadingPayouts ? (
                        <div className="p-16 flex justify-center">
                            <Loader2 className="w-8 h-8 animate-spin text-brand-navy/40" />
                        </div>
                    ) : payouts.length === 0 ? (
                        <div className="p-16 text-center text-muted-foreground text-sm">No payouts yet. Your first payout will appear here once admin generates it.</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-brand-navy/5 text-[10px] font-black uppercase tracking-widest text-brand-navy/40">
                                        <th className="text-left px-6 py-3">Month</th>
                                        <th className="text-left px-3 py-3">Type</th>
                                        <th className="text-right px-3 py-3">Delivered</th>
                                        <th className="text-right px-3 py-3">Spend</th>
                                        <th className="text-right px-3 py-3">Amount</th>
                                        <th className="text-left px-3 py-3">Status</th>
                                        <th className="text-left px-3 py-3 pr-6">Paid on</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payouts.map((p) => (
                                        <tr key={p.id} className="border-b border-brand-navy/[0.03] hover:bg-brand-navy/[0.02] tabular-nums">
                                            <td className="px-6 py-3">
                                                <div className="flex items-center gap-2">
                                                    <Calendar className="w-4 h-4 text-brand-navy/30" />
                                                    <span className="text-xs font-bold text-brand-navy">{format(parseISO(p.payout_month + '-01'), 'MMMM yyyy')}</span>
                                                </div>
                                            </td>
                                            <td className="px-3 py-3">
                                                <Badge className={cn('rounded-full text-[9px] font-black uppercase border-none', p.payment_type === 'commission' ? 'bg-primary/10 text-primary' : 'bg-indigo-500/10 text-indigo-600')}>
                                                    {p.payment_type}
                                                </Badge>
                                            </td>
                                            <td className="text-right px-3 py-3 text-xs font-bold text-emerald-600">{fmtNum(p.delivered_orders)}</td>
                                            <td className="text-right px-3 py-3 text-xs text-brand-navy/60" title={fmtCurFull(Number(p.total_spend))}>{fmtCur(Number(p.total_spend))}</td>
                                            <td className="text-right px-3 py-3 font-black text-brand-navy" title={fmtCurFull(Number(p.total_amount))}>{fmtCur(Number(p.total_amount))}</td>
                                            <td className="px-3 py-3">
                                                <Badge className={cn('rounded-full text-[9px] font-black uppercase border-none', p.status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600')}>
                                                    {p.status}
                                                </Badge>
                                            </td>
                                            <td className="px-3 py-3 pr-6 text-xs text-brand-navy/50">
                                                {p.paid_at ? format(new Date(p.paid_at), 'dd MMM yyyy') : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Bank details — write-once per field */}
            <BankDetailsCard profile={profile} currentUserId={currentUserId} />
        </div>
    );
};

// ─── Bank details card ────────────────────────────────────────────
// Each field is editable only while empty. Once saved, it becomes locked
// (read-only). To change a locked field the user has to ask an admin.
const BankDetailsCard: React.FC<{ profile: UserProfile | null | undefined; currentUserId: string | null }> = ({ profile, currentUserId }) => {
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const [draft, setDraft] = useState({
        bank_name: '',
        bank_account_holder: '',
        bank_rib: '',
        cin_number: '',
    });

    // Hydrate draft with any existing values so locked fields stay visible.
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
        // Only unlocked fields can be dirty. A locked field must never be pushed.
        if (!lock.bank_name && draft.bank_name.trim() !== (profile?.bank_name || '')) return true;
        if (!lock.bank_account_holder && draft.bank_account_holder.trim() !== (profile?.bank_account_holder || '')) return true;
        if (!lock.bank_rib && draft.bank_rib.trim() !== (profile?.bank_rib || '')) return true;
        if (!lock.cin_number && draft.cin_number.trim() !== (profile?.cin_number || '')) return true;
        return false;
    }, [draft, profile, lock]);

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!currentUserId) throw new Error('Not signed in');
            // Build the patch — only unlocked fields with non-empty values are written.
            // Locked fields are never sent to prevent accidental overwrite.
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
        <Card className="border-none rounded-[28px] bg-white/90 backdrop-blur shadow-sm">
            <CardContent className="p-6">
                <div className="flex items-center justify-between mb-5">
                    <div className="flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-brand-navy/60" />
                        <h2 className="text-xs font-black uppercase tracking-widest text-brand-navy/50">Bank details</h2>
                    </div>
                    {allLocked && (
                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-brand-navy/40">
                            <Lock className="w-3 h-3" />
                            Locked
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                    <div className="mt-5 flex items-center justify-between gap-4">
                        <p className="text-[11px] text-muted-foreground font-medium leading-snug max-w-md">
                            Once saved, these fields are locked. To change them later, contact an admin.
                        </p>
                        <Button
                            onClick={() => saveMutation.mutate()}
                            disabled={!hasDirtyChanges || saveMutation.isPending}
                            className="rounded-2xl bg-brand-navy hover:bg-brand-navy/90 text-white font-bold text-xs uppercase tracking-widest gap-2 shadow-xl shadow-brand-navy/20"
                        >
                            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            Save
                        </Button>
                    </div>
                )}

                {!allLocked && (
                    <div className="mt-4 rounded-2xl bg-amber-50 border border-amber-200 p-4 flex items-start gap-3 text-xs text-amber-800">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                            Your bank details are incomplete. Payouts will still be generated, but admin needs this information to actually pay
                            you.
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
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
    <div className={cn('rounded-2xl p-4 border', locked ? 'bg-brand-navy/[0.03] border-brand-navy/5' : 'bg-white border-brand-navy/10')}>
        <div className="flex items-center justify-between mb-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
            {locked && <Lock className="w-3 h-3 text-brand-navy/30" />}
        </div>
        {locked ? (
            <p className={cn('text-sm font-bold text-brand-navy break-all', mono && 'font-mono')}>{value || '—'}</p>
        ) : (
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={cn(
                    'h-10 rounded-xl border-none bg-brand-navy/[0.04] shadow-inner text-sm font-bold text-brand-navy placeholder:text-brand-navy/30 placeholder:font-medium',
                    mono && 'font-mono'
                )}
            />
        )}
    </div>
);

const PreviewCell: React.FC<{ label: string; value: string; valueTitle?: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = ({
    label,
    value,
    valueTitle,
    icon: Icon,
    tone,
}) => (
    <div className="rounded-2xl bg-white/80 backdrop-blur p-4 border border-brand-navy/[0.04]">
        <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className={cn('text-lg font-black tabular-nums leading-tight', tone)} title={valueTitle || value}>{value}</p>
            </div>
            <Icon className={cn('w-4 h-4 shrink-0', tone)} />
        </div>
    </div>
);

const StatCard: React.FC<{ label: string; value: string; valueTitle?: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = ({
    label,
    value,
    valueTitle,
    icon: Icon,
    tone,
}) => (
    <div className="rounded-3xl border border-gray-100/80 bg-white/90 p-5 shadow-sm backdrop-blur-sm">
        <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                <p className="text-2xl font-black tabular-nums text-gray-900 tracking-tight break-words" title={valueTitle || value}>
                    {value}
                </p>
            </div>
            <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', tone)}>
                <Icon className="h-5 w-5" />
            </div>
        </div>
    </div>
);

export default Payments;
