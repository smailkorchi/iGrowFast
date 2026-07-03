import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import { getPlatformSource } from '@/lib/campaignConstants';
import { toBusinessDate, shiftYmd } from '@/lib/dateBuckets';

// ═══════════════════════════════════════════════════════════════════════
// Media buyer monthly earnings — bulk computation for admin payout flow.
// ═══════════════════════════════════════════════════════════════════════
// Computes, for a given YYYY-MM month and the active business, the earnings
// of EVERY media buyer in the business. Used by the Salaries page to build
// the bulk payout preview table.
//
// Rules (mirrors useCampaignMetrics / useMediaBuyerStats attribution logic):
//
//  • payment_type === 'salary':
//       commission_earned  = 0
//       salary_earned      = users.salary_amount
//       total_amount       = salary_amount  (always full, regardless of activity)
//       delivered_orders   = 0
//       total_spend        = 0
//       campaigns_count    = 0
//
//  • payment_type === 'commission':
//       For each (entry_date, source) pair where the media buyer had at
//       least one campaign_daily_entries row in the month, count the
//       orders that match that day+source once. Sum delivered orders
//       across all such buckets.
//       commission_earned  = delivered_orders × users.commission_price
//       salary_earned      = 0
//       total_amount       = commission_earned
//       total_spend        = Σ entries.spend
//       campaigns_count    = distinct campaign_ids (NULL/orphaned counted as one synthetic bucket per platform)
//
//  • Also sums previously-paid amounts for the same (mediabuyer_id, month)
//    so the admin preview can show "already paid" vs "pending" split.
//
// All data is business-scoped via the active business id.
// ═══════════════════════════════════════════════════════════════════════

export type MediaBuyerEarnings = {
    mediabuyer_id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    avatar_config: unknown | null;
    phone: string | null;
    payment_type: 'commission' | 'salary' | null;
    commission_price: number;
    salary_amount: number;
    bank_name: string | null;
    bank_account_holder: string | null;
    bank_rib: string | null;
    cin_number: string | null;
    address: string | null;
    created_at: string | null;
    currency: string;
    // Computed for this month
    delivered_orders: number;
    total_spend: number;
    campaigns_count: number;
    salary_earned: number;
    commission_earned: number;
    total_amount: number; // what SHOULD be paid this month
    prior_paid_amount: number; // already paid for this month
    remaining_amount: number; // total_amount - prior_paid_amount (floor 0)
    // Payout row if one already exists for (mediabuyer_id, month)
    existing_payout: {
        id: string;
        status: 'pending' | 'partial' | 'paid';
        total_amount: number;
        paid_amount: number;
        paid_at: string | null;
    } | null;
};

type MBUser = {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    avatar_config: unknown | null;
    phone: string | null;
    role: string;
    payment_type: 'commission' | 'salary' | null;
    commission_price: number | null;
    salary_amount: number | null;
    bank_name: string | null;
    bank_account_holder: string | null;
    bank_rib: string | null;
    cin_number: string | null;
    address: string | null;
    created_at: string | null;
    active: boolean | null;
};

type Entry = {
    id: string;
    campaign_id: string | null;
    created_by: string | null;
    entry_date: string;
    platform: string;
    spend: number | string;
    leads: number;
};

type OrderRow = {
    id: string;
    date: string;
    source_name: string | null;
    package_status_id: string | null;
    replace: boolean | null;
};

type PaymentRow = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    total_amount: number | string;
    paid_amount: number | string;
    status: 'pending' | 'partial' | 'paid';
    paid_at: string | null;
};

const monthBounds = (month: string): { from: string; to: string } => {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
};

// `selfMbId` narrows the fetch to a single media buyer's own row. The MB
// Dashboard/Payments surfaces only ever display the current user's own
// earnings (they `.find(r => r.mediabuyer_id === currentUserId)`), so passing
// the caller's id keeps peers' banking/salary/PII columns out of the client's
// projection (need-to-know). Admin pages omit it and get every media buyer.
export function useMediaBuyerEarnings(month: string, opts?: { selfMbId?: string | null }) {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const selfMbId = opts?.selfMbId ?? null;
    const { deliveredPkgIds } = useStatusCategories();
    const { from, to } = useMemo(() => monthBounds(month), [month]);

    // 1. Media buyers in business (self only when selfMbId is set).
    const { data: mediabuyers = [], isLoading: loadingMBs } = useQuery<MBUser[]>({
        queryKey: ['mb-earnings-users', activeBusinessId, selfMbId ?? 'all'],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            let q = (supabase as any)
                .from('users')
                .select('id, name, email, avatar_url, avatar_config, phone, role, payment_type, commission_price, salary_amount, bank_name, bank_account_holder, bank_rib, cin_number, address, created_at, active')
                .eq('DigiCom Business', activeBusinessId)
                .eq('role', 'mediabuyer');
            if (selfMbId) q = q.eq('id', selfMbId);
            const { data, error } = await q;
            if (error) throw error;
            return (data || []) as MBUser[];
        },
        enabled: !!activeBusinessId,
    });

    // 2. All entries in this month for those media buyers.
    const mbIds = useMemo(() => mediabuyers.map((u) => u.id), [mediabuyers]);
    const { data: entries = [], isLoading: loadingEntries } = useQuery<Entry[]>({
        queryKey: ['mb-earnings-entries', activeBusinessId, month, mbIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || mbIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('campaign_daily_entries')
                .select('id, campaign_id, created_by, entry_date, platform, spend, leads')
                .eq('DigiCom Business', activeBusinessId)
                .in('created_by', mbIds)
                .gte('entry_date', from)
                .lte('entry_date', to);
            if (error) throw error;
            return (data || []) as Entry[];
        },
        enabled: !!activeBusinessId && mbIds.length > 0,
    });

    // 3. Distinct sources present in entries.
    const distinctSources = useMemo(() => {
        const set = new Set<string>();
        for (const e of entries) {
            const s = getPlatformSource(e.platform);
            if (s) set.add(s);
        }
        return set;
    }, [entries]);
    const sourceList = useMemo(() => Array.from(distinctSources), [distinctSources]);

    // 4. Orders in the month scoped to business + sources. Filtered client-side (ilike).
    // orders.date is timestamptz; entries use business-local day strings. Widen the
    // server-side window by 1 day on each end to capture orders near midnight that
    // would otherwise be mis-bucketed after the business-TZ conversion below.
    const { data: orders = [], isLoading: loadingOrders } = useQuery<OrderRow[]>({
        queryKey: ['mb-earnings-orders', activeBusinessId, month, sourceList.join(',')],
        queryFn: async () => {
            if (!activeBusinessId || sourceList.length === 0) return [];
            // Paginated so we never truncate at the 1000-row default cap.
            const data = await fetchAllRows<OrderRow>('orders', 'id, date, source_name, package_status_id, replace', {
                filters: [
                    { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                    { column: 'date', op: 'gte', value: shiftYmd(from, -1) },
                    { column: 'date', op: 'lte', value: `${shiftYmd(to, 1)}T23:59:59.999Z` },
                    { column: 'date_deleted', op: 'is', value: null },
                    { column: 'source_review_status', op: 'neq', value: 'pending' },
                ],
            });
            const srcLower = new Set(sourceList.map((s) => s.toLowerCase()));
            // Exclude exchange swap/return legs (replace=true) — not sales, so they
            // must not inflate MB delivered → commission in the bulk payout preview.
            // Matches the server-side mb_month_earned guard (swap_only=false).
            return data.filter((o) =>
                o.replace !== true && (o.source_name ? srcLower.has(o.source_name.toLowerCase()) : false)
            );
        },
        enabled: !!activeBusinessId && sourceList.length > 0,
    });

    // 5. Existing mediabuyer_payments for this month (all MBs in business).
    const { data: priorPayments = [], isLoading: loadingPayments } = useQuery<PaymentRow[]>({
        queryKey: ['mb-earnings-prior', activeBusinessId, month],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('mediabuyer_payments')
                .select('id, mediabuyer_id, payout_month, total_amount, paid_amount, status, paid_at')
                .eq('DigiCom Business', activeBusinessId)
                .eq('payout_month', month);
            if (error) throw error;
            return (data || []) as PaymentRow[];
        },
        enabled: !!activeBusinessId,
    });

    // 6. Compute per-mediabuyer earnings.
    const rows = useMemo<MediaBuyerEarnings[]>(() => {
        // Bucket orders by (date, source_lower) — once.
        const deliveredBy = new Map<string, number>();
        const key = (d: string, s: string) => `${d}|${s}`;
        for (const o of orders) {
            if (!o.date || !o.source_name || !o.package_status_id) continue;
            if (!deliveredPkgIds.has(o.package_status_id)) continue;
            const d = toBusinessDate(o.date);
            const s = o.source_name.toLowerCase();
            const k = key(d, s);
            deliveredBy.set(k, (deliveredBy.get(k) || 0) + 1);
        }

        // Bucket entries by mediabuyer_id.
        const entriesByMB = new Map<string, Entry[]>();
        for (const e of entries) {
            if (!e.created_by) continue;
            const arr = entriesByMB.get(e.created_by) || [];
            arr.push(e);
            entriesByMB.set(e.created_by, arr);
        }

        // Bucket prior payments by mediabuyer_id.
        const paymentsByMB = new Map<string, PaymentRow[]>();
        for (const p of priorPayments) {
            const arr = paymentsByMB.get(p.mediabuyer_id) || [];
            arr.push(p);
            paymentsByMB.set(p.mediabuyer_id, arr);
        }

        return mediabuyers.map<MediaBuyerEarnings>((u) => {
            const mbEntries = entriesByMB.get(u.id) || [];
            const mbPayments = paymentsByMB.get(u.id) || [];

            // Spend totals + day/source dedupe for delivered count + campaign counting.
            let totalSpend = 0;
            const daySourceSet = new Set<string>();
            const campaignSet = new Set<string>();
            for (const e of mbEntries) {
                totalSpend += Number(e.spend || 0);
                const src = getPlatformSource(e.platform);
                if (src) daySourceSet.add(key(e.entry_date, src));
                campaignSet.add(e.campaign_id || `__orphan__${e.platform}`);
            }

            let delivered = 0;
            daySourceSet.forEach((k) => {
                delivered += deliveredBy.get(k) || 0;
            });

            const commissionPrice = Number(u.commission_price || 0);
            const salaryAmount = Number(u.salary_amount || 0);
            const isSalary = u.payment_type === 'salary';
            const isCommission = u.payment_type === 'commission';

            const salary_earned = isSalary ? salaryAmount : 0;
            const commission_earned = isCommission ? delivered * commissionPrice : 0;
            const total_amount = salary_earned + commission_earned;

            const prior_paid_amount = mbPayments.reduce((a, p) => a + Number(p.total_amount || 0), 0);
            const remaining_amount = Math.max(0, total_amount - prior_paid_amount);
            const existing = mbPayments[0] || null;

            return {
                mediabuyer_id: u.id,
                name: u.name,
                email: u.email,
                avatar_url: u.avatar_url,
                avatar_config: u.avatar_config ?? null,
                phone: u.phone,
                payment_type: u.payment_type,
                commission_price: commissionPrice,
                salary_amount: salaryAmount,
                bank_name: u.bank_name,
                bank_account_holder: u.bank_account_holder,
                bank_rib: u.bank_rib,
                cin_number: u.cin_number,
                address: u.address ?? null,
                created_at: u.created_at ?? null,
                currency: 'MAD',
                delivered_orders: delivered,
                total_spend: totalSpend,
                campaigns_count: campaignSet.size,
                salary_earned,
                commission_earned,
                total_amount,
                prior_paid_amount,
                remaining_amount,
                existing_payout: existing
                    ? {
                          id: existing.id,
                          status: existing.status,
                          total_amount: Number(existing.total_amount || 0),
                          paid_amount: Number(existing.paid_amount || 0),
                          paid_at: existing.paid_at,
                      }
                    : null,
            };
        });
    }, [mediabuyers, entries, orders, priorPayments, deliveredPkgIds]);

    return {
        rows,
        isLoading: loadingMBs || loadingEntries || loadingOrders || loadingPayments,
    };
}
