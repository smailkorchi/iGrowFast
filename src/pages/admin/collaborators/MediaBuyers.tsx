import React, { useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, parseISO, differenceInDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import {
    Search,
    Megaphone,
    X,
    Phone,
    Mail,
    Wallet,
    PackageCheck,
    Target,
    Coins,
    Sparkles,
    ArrowUpRight,
    CreditCard,
    ShieldCheck,
    MapPin,
    Users as UsersIcon,
    Hash,
    Crown,
    Medal,
    BarChart3,
    UserCheck,
    DollarSign,
    AlertTriangle,
    RefreshCw,
    type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/users/UserAvatar';
import { cn } from '@/lib/utils';
import { fmtCurFull, fmtNum } from '@/lib/formatNumbers';
import { useMediaBuyerEarnings, type MediaBuyerEarnings } from '@/hooks/useMediaBuyerEarnings';
import { getPlatformIcon } from '@/lib/campaignConstants';

// ============ TYPES ============

type CampaignRow = {
    id: string;
    created_by: string | null;
    name: string;
    platform: string;
    status: 'active' | 'draft';
};

// ============ DESIGN TOKENS / SHARED BUILDING BLOCKS ============

const KPI_ACCENTS = {
    ink: { dot: 'bg-ant-ink', tile: 'bg-ant-ink/6 border-ant-ink/15 text-ant-ink' },
    orange: { dot: 'bg-ant-orange', tile: 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange' },
    green: { dot: 'bg-ant-green', tile: 'bg-ant-green/10 border-ant-green/25 text-ant-green' },
    rose: { dot: 'bg-ant-rose', tile: 'bg-ant-rose/10 border-ant-rose/25 text-ant-rose' },
} as const;

const MbKpi: React.FC<{
    label: string;
    value: number | string;
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

const MiniTile: React.FC<{ label: string; value: string; sub?: string; tone?: 'ink' | 'orange' | 'green' | 'rose' }> = ({ label, value, sub, tone = 'ink' }) => {
    const a = KPI_ACCENTS[tone];
    return (
        <div className="rounded-xl border border-ant-line bg-ant-paper p-3">
            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-mid">
                <span className={cn('h-1.5 w-1.5 rounded-full', a.dot)} />
                {label}
            </div>
            <p className="font-display text-[16px] font-semibold text-ant-ink tabular-nums mt-1.5">{value}</p>
            {sub && <p className="font-serif italic text-[11px] text-ant-mid mt-0.5">{sub}</p>}
        </div>
    );
};

const InfoRow: React.FC<{
    icon: LucideIcon;
    label: string;
    value: string;
    mono?: boolean;
}> = ({ icon: Icon, label, value, mono }) => (
    <div className="flex items-start gap-2.5 py-2 border-b border-ant-line last:border-0">
        <div className="w-7 h-7 rounded-lg bg-ant-light border border-ant-line flex items-center justify-center shrink-0">
            <Icon className="w-3.5 h-3.5 text-ant-ink" strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.24em] font-semibold text-ant-mid">{label}</p>
            <p className={cn('text-[12px] text-ant-ink mt-0.5 break-words', mono && 'font-mono tabular-nums')}>{value}</p>
        </div>
    </div>
);

// Payment-status tier (mirrors Sellers' deliveryTier shape): settled / partial / due.
//   remaining <= 0           → green  "Settled"
//   paid > 0 && remaining>0  → blue   "Partial"
//   else                     → orange "Pays due"
const paymentTier = (totalAmount: number, remaining: number) => {
    const paid = totalAmount - Math.max(0, remaining);
    if (remaining <= 0) return { stripe: 'bg-ant-green', text: 'text-ant-green', bg: 'bg-ant-green/10', border: 'border-ant-green/25', dot: 'bg-ant-green', label: 'Settled' };
    if (paid > 0) return { stripe: 'bg-ant-blue', text: 'text-ant-blue', bg: 'bg-ant-blue/10', border: 'border-ant-blue/25', dot: 'bg-ant-blue', label: 'Partial' };
    return { stripe: 'bg-ant-orange', text: 'text-ant-orange', bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', dot: 'bg-ant-orange', label: 'Pays due' };
};

const paymentPill = (type?: string | null) => {
    if (type === 'commission') return { bg: 'bg-ant-orange/10', border: 'border-ant-orange/25', text: 'text-ant-orange', dot: 'bg-ant-orange', label: 'Commission' };
    if (type === 'salary') return { bg: 'bg-ant-green/10', border: 'border-ant-green/25', text: 'text-ant-green', dot: 'bg-ant-green', label: 'Salary' };
    return { bg: 'bg-ant-light', border: 'border-ant-line', text: 'text-ant-mid', dot: 'bg-ant-mid', label: 'N/A' };
};

const rateLabel = (r: MediaBuyerEarnings) =>
    r.payment_type === 'commission'
        ? `${fmtNum(r.commission_price)} MAD/deliv`
        : r.payment_type === 'salary'
          ? `${fmtNum(r.salary_amount)} MAD/mo`
          : 'N/A';

// ============ MAIN COMPONENT ============

const MediaBuyers = () => {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const currentMonth = useMemo(() => format(new Date(), 'yyyy-MM'), []);
    // D5 ④: one gated RPC (`mb_roster_earnings`) behind the hook — the month's
    // payroll for the whole roster AND the lifetime payout list. The page's own
    // `mediabuyer_payments` lifetime select is folded into it; the roster's
    // campaign tally arrives as `owned_campaign_count`.
    const { rows: earnings, payouts: allPayouts, isLoading, isError, refetch } = useMediaBuyerEarnings(currentMonth);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<'delivered' | 'spend' | 'payroll' | 'unpaid'>('delivered');

    // Campaign LIST for the detail modal only (the roster card's tally comes
    // from the RPC). Scoped to the opened buyer and gated on modal open — the
    // kept-mounted trap, precedent [[chat-orders-history]]: the query lives in
    // the page (the modal component is redeclared every render and would
    // refetch on each remount), keyed on the selection and disabled until then.
    // `campaignsPending` gates the count + empty-state copy: this query is
    // modal-gated (lazy), so its `[]` default is "not known yet", NOT "none".
    // Rendering it as fact flashed "0 campaigns / No campaigns yet." on every
    // open, contradicting the card the admin just clicked (D5 review).
    const { data: mbCampaigns = [], isPending: campaignsPending } = useQuery<CampaignRow[]>({
        queryKey: ['mb-campaigns', activeBusinessId, selectedId],
        staleTime: 5 * 60 * 1000, // CB-3: near-static; mutations/seam invalidate
        queryFn: async () => {
            if (!activeBusinessId || !selectedId) return [];
            const { data, error } = await (supabase as any)
                .from('campaigns')
                .select('id, created_by, name, platform, status')
                .eq('DigiCom Business', activeBusinessId)
                .eq('created_by', selectedId);
            if (error) throw error;
            return (data || []) as CampaignRow[];
        },
        enabled: !!activeBusinessId && !!selectedId,
    });

    // Primary metric = delivered orders this month → drives default sort, podium & rank.
    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const list = q
            ? earnings.filter(
                  (r) =>
                      r.name.toLowerCase().includes(q) ||
                      r.email.toLowerCase().includes(q) ||
                      (r.phone || '').toLowerCase().includes(q)
              )
            : [...earnings];

        return list.sort((a, b) => {
            if (sortBy === 'delivered') return b.delivered_orders - a.delivered_orders;
            if (sortBy === 'spend') return b.total_spend - a.total_spend;
            if (sortBy === 'payroll') return b.total_amount - a.total_amount;
            if (sortBy === 'unpaid') return b.remaining_amount - a.remaining_amount;
            return 0;
        });
    }, [earnings, search, sortBy]);

    // Podium + rank both key on the PRIMARY metric (delivered orders this month).
    const podium = useMemo(() => {
        return [...earnings]
            .filter((r) => r.delivered_orders > 0)
            .sort((a, b) => b.delivered_orders - a.delivered_orders)
            .slice(0, 3);
    }, [earnings]);

    const rankMap = useMemo(() => {
        const sorted = [...earnings].sort((a, b) => b.delivered_orders - a.delivered_orders);
        const map = new Map<string, number>();
        sorted.forEach((r, i) => map.set(r.mediabuyer_id, i + 1));
        return map;
    }, [earnings]);

    const totals = useMemo(() => {
        return earnings.reduce(
            (acc, r) => {
                acc.totalSpend += r.total_spend;
                acc.totalDelivered += r.delivered_orders;
                acc.totalAmount += r.total_amount;
                acc.unpaidAmount += r.remaining_amount;
                acc.active += 1;
                return acc;
            },
            { totalSpend: 0, totalDelivered: 0, totalAmount: 0, unpaidAmount: 0, active: 0 }
        );
    }, [earnings]);

    const selected = useMemo(() => earnings.find((e) => e.mediabuyer_id === selectedId) || null, [earnings, selectedId]);

    // ========== PODIUM CARD ==========
    const PodiumCard: React.FC<{ buyer: MediaBuyerEarnings; rank: 1 | 2 | 3 }> = ({ buyer, rank }) => {
        const tier = paymentTier(buyer.total_amount, buyer.remaining_amount);
        const pp = paymentPill(buyer.payment_type);

        const rankMeta = rank === 1
            ? { icon: Crown, accentBg: 'bg-ant-orange/10', accentBorder: 'border-ant-orange/30', accentText: 'text-ant-orange', label: 'Top buyer · 01', avatarSize: 'h-20 w-20', nameSize: 'text-[22px]', rankBg: 'bg-ant-orange text-white' }
            : rank === 2
            ? { icon: Medal, accentBg: 'bg-ant-ink/6', accentBorder: 'border-ant-ink/20', accentText: 'text-ant-ink', label: 'Runner up · 02', avatarSize: 'h-16 w-16', nameSize: 'text-[18px]', rankBg: 'bg-ant-ink text-white' }
            : { icon: Medal, accentBg: 'bg-ant-rose/8', accentBorder: 'border-ant-rose/25', accentText: 'text-ant-rose', label: 'Third place · 03', avatarSize: 'h-16 w-16', nameSize: 'text-[18px]', rankBg: 'bg-ant-rose text-white' };
        const RankIcon = rankMeta.icon;

        return (
            <div
                onClick={() => setSelectedId(buyer.mediabuyer_id)}
                className={cn(
                    'relative overflow-hidden rounded-2xl border bg-ant-paper cursor-pointer transition-all hover:border-ant-ink/20 hover:shadow-[0_24px_60px_-24px_rgba(20,20,19,0.22)]',
                    rankMeta.accentBorder
                )}
            >
                <div className={cn('h-[3px] w-full', rank === 1 ? 'bg-ant-orange' : rank === 2 ? 'bg-ant-ink' : 'bg-ant-rose')} />
                <div className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className={cn('inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', rankMeta.accentBg, rankMeta.accentBorder, rankMeta.accentText)}>
                            <RankIcon className="w-3 h-3" />
                            {rankMeta.label}
                        </div>
                        <div className={cn('inline-flex items-center justify-center h-8 w-8 rounded-full font-display font-semibold text-[13px]', rankMeta.rankBg)}>
                            {rank}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <UserAvatar url={buyer.avatar_url} config={(buyer as any).avatar_config} name={buyer.name} className={cn('rounded-2xl border border-ant-line shrink-0', rankMeta.avatarSize)} />
                        <div className="min-w-0 flex-1">
                            <h3 className={cn('font-display font-semibold text-ant-ink leading-tight truncate', rankMeta.nameSize)}>{buyer.name}</h3>
                            <p className="text-[11px] text-ant-mid truncate mt-0.5">{buyer.email}</p>
                            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold mt-1.5', pp.bg, pp.border, pp.text)}>
                                <span className={cn('h-1.5 w-1.5 rounded-full', pp.dot)} />
                                {pp.label}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Delivered</p>
                            <p className="font-display text-[18px] font-semibold text-ant-green tabular-nums mt-0.5">{fmtNum(buyer.delivered_orders)}</p>
                        </div>
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Spend</p>
                            <p className="font-display text-[15px] font-semibold text-ant-rose tabular-nums mt-0.5 truncate" title={fmtCurFull(buyer.total_spend)}>
                                {fmtNum(buyer.total_spend)}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                        <div className="bg-ant-paper p-3">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Payroll</p>
                            <p className="font-display text-[15px] font-semibold text-ant-ink tabular-nums mt-0.5 truncate" title={fmtCurFull(buyer.total_amount)}>
                                {fmtNum(buyer.total_amount)}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                        <div className="min-w-0">
                            <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-ant-mid">Unpaid</p>
                            <p className="font-display text-[16px] font-semibold text-ant-ink tabular-nums truncate" title={fmtCurFull(buyer.remaining_amount)}>
                                {fmtNum(buyer.remaining_amount)}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-ant-mid">
                            View <ArrowUpRight className="w-3.5 h-3.5" />
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ========== ROSTER CARD ==========
    const RosterCard: React.FC<{ buyer: MediaBuyerEarnings; rank: number }> = ({ buyer, rank }) => {
        const tier = paymentTier(buyer.total_amount, buyer.remaining_amount);
        const pp = paymentPill(buyer.payment_type);
        // Payment-progress bar = paid / total payroll this month.
        const paid = Math.max(0, buyer.total_amount - buyer.remaining_amount);
        const pct = buyer.total_amount > 0 ? Math.min(100, (paid / buyer.total_amount) * 100) : (buyer.remaining_amount <= 0 ? 100 : 0);

        return (
            <div
                onClick={() => setSelectedId(buyer.mediabuyer_id)}
                className="relative overflow-hidden rounded-2xl border border-ant-line bg-ant-paper cursor-pointer hover:border-ant-ink/20 hover:shadow-[0_16px_48px_-20px_rgba(20,20,19,0.15)] transition-all group"
            >
                <div className={cn('h-[3px] w-full', tier.stripe)} />
                <div className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                        <UserAvatar url={buyer.avatar_url} config={(buyer as any).avatar_config} name={buyer.name} className="h-12 w-12 shrink-0 rounded-2xl border border-ant-line" />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                                <h3 className="font-display text-[14px] font-semibold text-ant-ink truncate">{buyer.name}</h3>
                                <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ant-mid tabular-nums">
                                    #{rank}
                                </span>
                            </div>
                            <p className="text-[11px] text-ant-mid truncate mt-0.5">{buyer.email}</p>
                        </div>
                        <ArrowUpRight className="w-4 h-4 text-ant-mid opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>

                    {/* Payment type + campaigns count */}
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', pp.bg, pp.border, pp.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', pp.dot)} />
                            {pp.label}
                            {buyer.payment_type === 'commission' && (
                                <span className="text-ant-mid font-normal ml-1 tabular-nums">{fmtNum(buyer.commission_price)} MAD/deliv</span>
                            )}
                            {buyer.payment_type === 'salary' && (
                                <span className="text-ant-mid font-normal ml-1 tabular-nums">{fmtNum(buyer.salary_amount)} MAD/mo</span>
                            )}
                        </span>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                            <Hash className="w-2.5 h-2.5 text-ant-mid" />
                            {buyer.owned_campaign_count} campaigns
                        </span>
                    </div>

                    {/* Payment-progress bar (paid / total payroll) */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.18em] text-ant-mid">
                            <span>Paid</span>
                            <span className={cn('font-display text-[14px] tracking-normal tabular-nums normal-case', tier.text)}>
                                {pct.toFixed(0)}%
                            </span>
                        </div>
                        <div className="h-1.5 bg-ant-line rounded-full overflow-hidden">
                            <div className={cn('h-full rounded-full transition-all', tier.stripe)} style={{ width: `${pct}%` }} />
                        </div>
                    </div>

                    {/* 4-col hairline stats */}
                    <div className="grid grid-cols-4 gap-px bg-ant-line rounded-xl border border-ant-line overflow-hidden">
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Spend</p>
                            <p className="text-[12px] font-semibold text-ant-rose tabular-nums truncate" title={fmtCurFull(buyer.total_spend)}>{fmtNum(buyer.total_spend)}</p>
                        </div>
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Deliv</p>
                            <p className="text-[12px] font-semibold text-ant-green tabular-nums">{fmtNum(buyer.delivered_orders)}</p>
                        </div>
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Payroll</p>
                            <p className="text-[12px] font-semibold text-ant-ink tabular-nums truncate" title={fmtCurFull(buyer.total_amount)}>{fmtNum(buyer.total_amount)}</p>
                        </div>
                        <div className="bg-ant-paper px-2.5 py-2">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Unpaid</p>
                            <p className={cn('text-[12px] font-semibold tabular-nums truncate', buyer.remaining_amount > 0 ? 'text-ant-orange' : 'text-ant-mid')} title={fmtCurFull(buyer.remaining_amount)}>{fmtNum(buyer.remaining_amount)}</p>
                        </div>
                    </div>

                    {/* Tier pill + headline footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-ant-line">
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tier.bg, tier.border, tier.text)}>
                            <span className={cn('h-1.5 w-1.5 rounded-full', tier.dot)} />
                            {tier.label}
                        </span>
                        <div className="text-right">
                            <p className="text-[9px] uppercase tracking-[0.2em] font-semibold text-ant-mid">Remaining</p>
                            <p className="font-display text-[14px] font-semibold text-ant-ink tabular-nums" title={fmtCurFull(buyer.remaining_amount)}>
                                {fmtNum(buyer.remaining_amount)}
                                <span className="text-[10px] text-ant-mid font-normal ml-1">MAD</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    // ========== DETAIL MODAL ==========
    const MbDetailModal = ({ buyer, onClose }: { buyer: MediaBuyerEarnings; onClose: () => void }) => {
        const pp = paymentPill(buyer.payment_type);
        const tier = paymentTier(buyer.total_amount, buyer.remaining_amount);
        const totalPaid = Math.max(0, buyer.total_amount - buyer.remaining_amount);
        const daysActive = buyer.created_at ? differenceInDays(new Date(), new Date(buyer.created_at)) + 1 : null;
        const cpd = buyer.delivered_orders > 0 ? buyer.total_spend / buyer.delivered_orders : 0;

        // Already scoped to this buyer by the modal-gated query above.
        const campaigns = mbCampaigns;
        const payouts = allPayouts.filter((p) => p.mediabuyer_id === buyer.mediabuyer_id);
        const lastPaid = payouts.find((p) => p.paid_at)?.paid_at || null;

        return (
            <div
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ant-ink/55 backdrop-blur-sm"
                onClick={onClose}
            >
                <div
                    className="ant-surface relative bg-ant-paper rounded-2xl border border-ant-line w-full max-w-4xl max-h-[92vh] overflow-y-auto ant-scroll shadow-[0_24px_80px_-24px_rgba(20,20,19,0.28)]"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Editorial header */}
                    <div className="sticky top-0 bg-ant-paper z-10 border-b border-ant-line px-6 py-5">
                        <div className="flex items-start gap-4">
                            <div className="relative shrink-0">
                                <UserAvatar url={buyer.avatar_url} config={(buyer as any).avatar_config} name={buyer.name} className="h-14 w-14 rounded-2xl border border-ant-line" />
                                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-ant-paper bg-ant-green" />
                            </div>
                            <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                    Media buyer · Profile
                                </div>
                                <h2 className="font-display text-[22px] leading-tight tracking-tight text-ant-ink truncate">{buyer.name}</h2>
                                <div className="flex flex-wrap items-center gap-3 text-[12px] text-ant-mid">
                                    <span className="inline-flex items-center gap-1.5">
                                        <Mail className="w-3.5 h-3.5" /> {buyer.email}
                                    </span>
                                    {buyer.phone && (
                                        <>
                                            <span>·</span>
                                            <span className="inline-flex items-center gap-1.5 tabular-nums">
                                                <Phone className="w-3.5 h-3.5" /> {buyer.phone}
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={onClose}
                                className="h-9 w-9 rounded-full hover:bg-ant-ink/5 text-ant-mid cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Contract config */}
                        <section className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                            <MbKpi label="Payment" value={rateLabel(buyer)} accent="orange" icon={Coins} />
                            <MbKpi label="Campaigns" value={campaignsPending ? '—' : campaigns.length} suffix="created" accent="ink" icon={Megaphone} />
                            <MbKpi label="Delivered" value={fmtNum(buyer.delivered_orders)} suffix="orders" accent="green" icon={PackageCheck} />
                            <MbKpi label="Days since join" value={daysActive ?? '—'} suffix={daysActive != null ? 'days' : undefined} accent="ink" icon={UserCheck} />
                        </section>

                        {/* Performance · month */}
                        <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                            <div className="h-[3px] w-full bg-ant-orange" />
                            <div className="p-5 space-y-4">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <BarChart3 className="w-3 h-3" />
                                    Performance · month
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    <MiniTile label="Spend" value={`${fmtNum(buyer.total_spend)} MAD`} tone="rose" />
                                    <MiniTile label="Delivered" value={fmtNum(buyer.delivered_orders)} sub="orders" tone="green" />
                                    <MiniTile label="Payroll" value={`${fmtNum(buyer.total_amount)} MAD`} tone="orange" />
                                    <MiniTile label="Cost / deliv" value={`${fmtNum(cpd)} MAD`} sub="CPD" tone="ink" />
                                </div>
                            </div>
                        </section>

                        {/* Financial overview — ink panel */}
                        <section className="rounded-2xl border border-ant-ink bg-ant-ink text-white overflow-hidden">
                            <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-white/55">
                                    <DollarSign className="w-3 h-3" />
                                    Financial overview
                                </div>
                                <Sparkles className="w-3.5 h-3.5 text-ant-orange/70" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-white/10">
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
                                        Spend
                                    </div>
                                    <p className="font-display text-[22px] font-semibold text-ant-rose tabular-nums mt-1.5" title={fmtCurFull(buyer.total_spend)}>
                                        {fmtNum(buyer.total_spend)}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                                        Payroll
                                    </div>
                                    <p className="font-display text-[22px] font-semibold text-white tabular-nums mt-1.5" title={fmtCurFull(buyer.total_amount)}>
                                        {fmtNum(buyer.total_amount)}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                                <div className="px-5 py-4">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-white/55">
                                        <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                        Unpaid
                                    </div>
                                    <p className={cn('font-display text-[22px] font-semibold tabular-nums mt-1.5', buyer.remaining_amount > 0 ? 'text-ant-orange' : 'text-white/40')} title={fmtCurFull(buyer.remaining_amount)}>
                                        {fmtNum(buyer.remaining_amount)}
                                        <span className="text-[11px] text-white/55 font-normal ml-1.5">MAD</span>
                                    </p>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-px bg-white/10 border-t border-white/10">
                                {[
                                    { label: 'Commission rate', value: rateLabel(buyer), raw: true },
                                    { label: 'Total paid', value: fmtNum(totalPaid), full: fmtCurFull(totalPaid) },
                                    { label: 'Remaining', value: fmtNum(buyer.remaining_amount), full: fmtCurFull(buyer.remaining_amount) },
                                ].map((t) => (
                                    <div key={t.label} className="bg-ant-ink px-5 py-3">
                                        <p className="text-[9px] uppercase tracking-[0.24em] font-semibold text-white/55">{t.label}</p>
                                        <p className="font-display text-[14px] font-semibold text-white mt-0.5 tabular-nums" title={t.full}>
                                            {t.value} {t.raw ? null : <span className="text-[10px] text-white/55 font-normal">MAD</span>}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {/* Account + Campaigns */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <UserCheck className="w-3 h-3" />
                                    Account
                                </div>
                                {[
                                    { label: 'Payment type', value: pp.label },
                                    { label: 'Member since', value: buyer.created_at ? format(parseISO(buyer.created_at), 'MMM d, yyyy') : 'N/A' },
                                    { label: 'Last paid', value: lastPaid ? format(parseISO(lastPaid), 'MMM d, yyyy') : 'Never' },
                                    { label: 'Campaigns', value: campaignsPending ? '—' : String(campaigns.length) },
                                ].map((r) => (
                                    <div key={r.label} className="flex items-center justify-between py-2 border-b border-ant-line last:border-0">
                                        <span className="text-[11px] text-ant-mid">{r.label}</span>
                                        <span className="text-[12px] font-semibold text-ant-ink tabular-nums">{r.value}</span>
                                    </div>
                                ))}
                            </section>

                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3 flex flex-col">
                                <div className="flex items-center justify-between shrink-0">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <Megaphone className="w-3 h-3" />
                                        Campaigns
                                    </div>
                                    <span className="inline-flex items-center rounded-full border border-ant-line bg-ant-light px-2 py-0.5 text-[10px] font-semibold text-ant-ink tabular-nums">
                                        {campaignsPending ? '—' : campaigns.length}
                                    </span>
                                </div>
                                {campaignsPending ? (
                                    <div className="py-4 space-y-2">
                                        <div className="h-8 rounded-lg bg-ant-line animate-pulse" />
                                        <div className="h-8 rounded-lg bg-ant-line animate-pulse" />
                                    </div>
                                ) : campaigns.length === 0 ? (
                                    <p className="font-serif italic text-[12px] text-ant-mid py-4 text-center">No campaigns yet.</p>
                                ) : (
                                    <div className="ant-scroll max-h-[220px] overflow-y-auto pr-1 -mr-1 space-y-1">
                                        {campaigns.map((c) => {
                                            const isActive = c.status === 'active';
                                            return (
                                                <div key={c.id} className="flex items-center gap-2.5 py-1.5 border-b border-ant-line last:border-0">
                                                    <div className="w-8 h-8 bg-ant-light rounded-lg border border-ant-line flex items-center justify-center shrink-0 text-ant-ink">
                                                        {getPlatformIcon(c.platform, 'w-3.5 h-3.5')}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[12px] text-ant-ink truncate">{c.name}</p>
                                                        <p className="text-[10px] text-ant-mid uppercase tracking-[0.18em] font-semibold">{c.platform}</p>
                                                    </div>
                                                    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize', isActive ? 'bg-ant-green/10 border-ant-green/25 text-ant-green' : 'bg-ant-orange/10 border-ant-orange/25 text-ant-orange')}>
                                                        <span className={cn('h-1.5 w-1.5 rounded-full', isActive ? 'bg-ant-green' : 'bg-ant-orange')} />
                                                        {c.status}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* Payout history */}
                        {payouts.length > 0 && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper overflow-hidden">
                                <div className="px-5 py-3.5 border-b border-ant-line flex items-center justify-between">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <CreditCard className="w-3 h-3" />
                                        Payout history
                                    </div>
                                    <span className="text-[11px] font-semibold text-ant-mid tabular-nums">{payouts.length} months</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-ant-line">
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Month</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Delivered</th>
                                                <th className="px-4 py-3.5 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Total</th>
                                                <th className="px-4 py-3.5 text-right text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Paid</th>
                                                <th className="px-4 py-3.5 text-left text-[10px] uppercase tracking-[0.22em] font-semibold text-ant-mid/80">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {payouts.map((p) => {
                                                const totalAmount = Number(p.total_amount) || 0;
                                                const paidAmount = Number(p.paid_amount) || 0;
                                                const pct = totalAmount > 0 ? Math.min(100, (paidAmount / totalAmount) * 100) : 0;
                                                const isPaid = p.status === 'paid';
                                                const isPartial = p.status === 'partial';
                                                const statusMeta = isPaid
                                                    ? { bg: 'bg-ant-green/10', text: 'text-ant-green', dot: 'bg-ant-green' }
                                                    : isPartial
                                                      ? { bg: 'bg-ant-blue/10', text: 'text-ant-blue', dot: 'bg-ant-blue' }
                                                      : { bg: 'bg-ant-orange/10', text: 'text-ant-orange', dot: 'bg-ant-orange' };
                                                return (
                                                    <tr key={p.id} className="border-t border-ant-line/60 hover:bg-ant-light/40 transition-colors tabular-nums">
                                                        <td className="px-4 py-3.5 text-[12px] font-semibold text-ant-ink whitespace-nowrap">{format(parseISO(p.payout_month.length === 7 ? `${p.payout_month}-01` : p.payout_month), 'MMM yyyy')}</td>
                                                        <td className="px-4 py-3.5 text-[13px] text-ant-green font-semibold">{fmtNum(p.delivered_orders || 0)}</td>
                                                        <td className="px-4 py-3.5 text-right text-[13px] font-semibold text-ant-ink">
                                                            {fmtNum(totalAmount)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                        </td>
                                                        <td className="px-4 py-3.5 text-right" title={`${fmtCurFull(paidAmount)} paid of ${fmtCurFull(totalAmount)}`}>
                                                            <div className="flex flex-col items-end gap-1.5">
                                                                <span className={cn('text-[13px] font-semibold tabular-nums leading-none', paidAmount > 0 ? 'text-ant-green' : 'text-ant-mid/60')}>
                                                                    {fmtNum(paidAmount)} <span className="text-[10px] text-ant-mid font-normal">MAD</span>
                                                                </span>
                                                                {isPartial && (
                                                                    <div className="h-1 w-24 rounded-full bg-ant-line/60 overflow-hidden">
                                                                        <div className="h-full rounded-full bg-ant-blue transition-all" style={{ width: `${pct}%` }} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3.5">
                                                            <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold capitalize', statusMeta.bg, statusMeta.text)}>
                                                                <span className={cn('h-1.5 w-1.5 rounded-full', statusMeta.dot)} />
                                                                {p.status}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        )}

                        {/* Personal & Banking */}
                        {(buyer.cin_number || buyer.bank_name || buyer.address || buyer.phone || buyer.bank_rib) && (
                            <section className="rounded-2xl border border-ant-line bg-ant-paper p-5 space-y-3">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <ShieldCheck className="w-3 h-3" />
                                    Personal &amp; banking
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {buyer.bank_name && <InfoRow icon={CreditCard} label="Bank" value={buyer.bank_name} />}
                                    {buyer.bank_rib && <InfoRow icon={CreditCard} label="RIB" value={buyer.bank_rib} mono />}
                                    {buyer.cin_number && <InfoRow icon={ShieldCheck} label="CIN" value={buyer.cin_number} />}
                                    {buyer.phone && <InfoRow icon={Phone} label="Phone" value={buyer.phone} />}
                                    {buyer.email && <InfoRow icon={Mail} label="Email" value={buyer.email} />}
                                    {buyer.address && <InfoRow icon={MapPin} label="Address" value={buyer.address} />}
                                </div>
                            </section>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    // ========== RENDER ==========
    return (
        <>
            <div className="ant-surface min-h-screen">
                <div className="px-4 md:px-8 py-6 md:py-8 space-y-6">
                    {/* Editorial header */}
                    <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
                        <div className="space-y-2">
                            <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
                                Collaborators · Media buyers
                            </div>
                            <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
                                Media Buyers
                            </h1>
                            <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
                                The budget-holders of attention — spend watched, deliveries counted, commission tallied. Crown the three who drove the most boxes this month.
                            </p>
                        </div>
                        <div className="inline-flex items-center gap-1.5 rounded-full border border-ant-line bg-ant-paper px-3 h-9 text-[12px] font-semibold text-ant-ink shrink-0">
                            <Target className="w-3.5 h-3.5 text-ant-orange" />
                            <span className="tabular-nums">
                                {format(startOfMonth(new Date()), 'MMM dd')} – {format(endOfMonth(new Date()), 'MMM dd')}
                            </span>
                            <span className="text-ant-mid font-normal">scope</span>
                        </div>
                    </header>

                    {/* KPI strip */}
                    <section className="grid grid-cols-2 md:grid-cols-5 gap-px bg-ant-line rounded-2xl border border-ant-line overflow-hidden">
                        <MbKpi label="Media buyers" value={earnings.length} suffix="active" accent="ink" icon={UsersIcon} />
                        <MbKpi label="Spend · month" value={fmtNum(totals.totalSpend)} suffix="MAD" accent="rose" icon={Coins} />
                        <MbKpi label="Delivered · month" value={fmtNum(totals.totalDelivered)} suffix="orders" accent="green" icon={PackageCheck} />
                        <MbKpi label="Payroll · month" value={fmtNum(totals.totalAmount)} suffix="MAD" accent="ink" icon={Wallet} />
                        <MbKpi label="Unpaid" value={fmtNum(totals.unpaidAmount)} suffix="MAD" accent="orange" icon={CreditCard} />
                    </section>

                    {/* Podium — top 3 by delivered this month */}
                    {!isLoading && podium.length > 0 && (
                        <section className="space-y-3">
                            <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                        <span className="font-display text-ant-orange font-semibold">01</span>
                                        Podium
                                    </div>
                                    <h2 className="font-display text-[22px] tracking-tight text-ant-ink">The drivers</h2>
                                    <p className="font-serif italic text-[12px] text-ant-mid max-w-xl">Ranked by deliveries driven this month — the three budgets that converted the most.</p>
                                </div>
                                <div className="hidden md:flex h-12 w-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 items-center justify-center shrink-0">
                                    <Crown className="w-5 h-5 text-ant-orange" strokeWidth={1.5} />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                {podium[0] && (
                                    <div className="md:col-span-2 md:row-span-1">
                                        <PodiumCard buyer={podium[0]} rank={1} />
                                    </div>
                                )}
                                {podium[1] && (
                                    <div className="md:col-span-1">
                                        <PodiumCard buyer={podium[1]} rank={2} />
                                    </div>
                                )}
                                {podium[2] && (
                                    <div className="md:col-span-1">
                                        <PodiumCard buyer={podium[2]} rank={3} />
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Full roster */}
                    <section className="space-y-3">
                        <div className="flex items-end justify-between gap-3 border-b border-ant-line pb-3">
                            <div className="space-y-1">
                                <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
                                    <span className="font-display text-ant-orange font-semibold">02</span>
                                    Roster
                                </div>
                                <h2 className="font-display text-[22px] tracking-tight text-ant-ink">
                                    Every buyer
                                    <span className="ml-2 text-[13px] font-normal text-ant-mid tabular-nums">· {filtered.length}</span>
                                </h2>
                            </div>
                        </div>

                        {/* Search + Sort toolbar */}
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                            <div className="relative w-full md:w-[340px]">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ant-mid pointer-events-none" />
                                <Input
                                    placeholder="Search name, email, phone..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    className="pl-9 h-10 rounded-full border-ant-line bg-ant-paper text-[12px] text-ant-ink placeholder:text-ant-mid focus-visible:ring-1 focus-visible:ring-ant-orange/40"
                                />
                            </div>

                            <div className="inline-flex items-center gap-1 p-1 rounded-full border border-ant-line bg-ant-paper">
                                {([
                                    { key: 'delivered', label: 'Delivered' },
                                    { key: 'spend', label: 'Spend' },
                                    { key: 'payroll', label: 'Payroll' },
                                    { key: 'unpaid', label: 'Unpaid' },
                                ] as const).map((t) => {
                                    const active = sortBy === t.key;
                                    return (
                                        <button
                                            key={t.key}
                                            onClick={() => setSortBy(t.key)}
                                            className={cn(
                                                'inline-flex items-center rounded-full px-3.5 h-8 text-[11px] font-semibold transition cursor-pointer whitespace-nowrap',
                                                active ? 'bg-ant-ink text-white' : 'text-ant-mid hover:text-ant-ink'
                                            )}
                                        >
                                            {t.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {isError ? (
                            <div className="rounded-2xl border border-dashed border-ant-rose/40 bg-ant-paper px-8 py-16 text-center">
                                <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-rose/10 border border-ant-rose/25 flex items-center justify-center mb-4">
                                    <AlertTriangle className="w-5 h-5 text-ant-rose" strokeWidth={1.75} />
                                </div>
                                <h3 className="font-display text-[18px] text-ant-ink tracking-tight">Payroll could not be loaded</h3>
                                <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                                    The month's spend and commission never arrived — every figure above is missing, not zero.
                                </p>
                                <Button
                                    onClick={() => refetch()}
                                    className="mt-5 h-9 rounded-full bg-ant-ink text-white hover:bg-ant-ink/90 text-[12px] font-semibold cursor-pointer"
                                >
                                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                    Try again
                                </Button>
                            </div>
                        ) : isLoading ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <div key={i} className="h-60 rounded-2xl bg-ant-light animate-pulse" />
                                ))}
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-ant-line bg-ant-paper px-8 py-16 text-center">
                                <div className="mx-auto w-12 h-12 rounded-2xl bg-ant-orange/10 border border-ant-orange/25 flex items-center justify-center mb-4">
                                    <Megaphone className="w-5 h-5 text-ant-orange" strokeWidth={1.75} />
                                </div>
                                <h3 className="font-display text-[18px] text-ant-ink tracking-tight">
                                    {earnings.length ? 'No media buyers match that search' : 'No media buyers yet'}
                                </h3>
                                <p className="font-serif italic text-[13px] text-ant-mid mt-2 max-w-sm mx-auto">
                                    {earnings.length
                                        ? 'Loosen the search to bring the team back into view.'
                                        : 'Create a media-buyer user from the Users page — their spend and campaigns will surface here.'}
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {filtered.map((r) => (
                                    <RosterCard
                                        key={r.mediabuyer_id}
                                        buyer={r}
                                        rank={rankMap.get(r.mediabuyer_id) ?? 0}
                                    />
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            </div>

            {/* Detail Modal */}
            <AnimatePresence>
                {selected && (
                    <MbDetailModal buyer={selected} onClose={() => setSelectedId(null)} />
                )}
            </AnimatePresence>
        </>
    );
};

export default MediaBuyers;
