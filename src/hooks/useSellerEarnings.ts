import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ═══════════════════════════════════════════════════════════════════════
// Seller monthly earnings — bulk computation for admin payout flow.
// ═══════════════════════════════════════════════════════════════════════
// Computes, for a given YYYY-MM month and the active business, the earnings
// of EVERY seller (role='commercial') in the business. Mirrors the single-
// seller logic previously embedded in pages/Salaries.tsx.
//
// Rules:
//  • Month accrual comes from seller_daily_earnings filtered by date in
//    [first day of month, last day of month] per seller.
//  • `prior_paid_amount` subtracts any already-generated seller_payments
//    rows for the same (seller_id, payout_month) so re-generating the
//    same month never double-counts.
//  • `days_present` is proportional to remainder: ceil((remainder / full_month) * month_days),
//    clamped to [1, month_days] when there's any remainder.
//  • `total_amount = commission_earned` (salary_earned is always 0 for commercials).
//
// The payout_month key for sellers is stored as 'yyyy-MM-01' (date-like
// text) to match the existing seller_payments convention. Do not change
// this — the seller Wallet and existing reports rely on it.
// ═══════════════════════════════════════════════════════════════════════

export type SellerEarnings = {
    seller_id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    phone: string | null;
    commission_price: number;
    commission_basis: string | null;
    bank_name: string | null;
    bank_account_holder: string | null;
    bank_rib: string | null;
    cin_number: string | null;
    // Computed this month
    month_commission: number; // full accrual (before subtracting prior payouts)
    month_orders: number;
    month_days: number;
    prior_commission: number;
    prior_orders: number;
    // Remainder — what would be generated now
    commission_earned: number;
    delivered_orders: number;
    days_present: number;
    salary_earned: number; // always 0
    total_amount: number; // == commission_earned
    // Existing payout (if any) — informational only
    existing_payout: {
        id: string;
        status: 'pending' | 'paid';
        total_amount: number;
        paid_at: string | null;
    } | null;
};

type SellerUser = {
    id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    phone: string | null;
    commission_price: number | null;
    commission_basis: string | null;
    bank_name: string | null;
    bank_account_holder: string | null;
    bank_rib: string | null;
    cin_number: string | null;
};

type DailyEarning = {
    seller_id: string;
    date: string;
    commission_earned: number | string;
    delivered_count: number;
};

type PriorPayment = {
    id: string;
    seller_id: string;
    payout_month: string;
    commission_earned: number | string;
    delivered_orders: number;
    total_amount: number | string;
    status: 'pending' | 'paid';
    paid_at: string | null;
};

const monthBounds = (month: string): { from: string; to: string; payoutMonthKey: string } => {
    // month is YYYY-MM. payout_month in seller_payments is stored as YYYY-MM-01.
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return {
        from: `${month}-01`,
        to: `${month}-${String(last).padStart(2, '0')}`,
        payoutMonthKey: `${month}-01`,
    };
};

export function useSellerEarnings(month: string) {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const bounds = useMemo(() => monthBounds(month), [month]);

    const { data: sellers = [], isLoading: loadingSellers } = useQuery<SellerUser[]>({
        queryKey: ['seller-earnings-users', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, email, avatar_url, phone, commission_price, commission_basis, bank_name, bank_account_holder, bank_rib, cin_number')
                .eq('DigiCom Business', activeBusinessId)
                .eq('role', 'commercial');
            if (error) throw error;
            return (data || []) as SellerUser[];
        },
        enabled: !!activeBusinessId,
    });

    const sellerIds = useMemo(() => sellers.map((s) => s.id), [sellers]);

    const { data: dailyEarnings = [], isLoading: loadingDaily } = useQuery<DailyEarning[]>({
        queryKey: ['seller-earnings-daily', activeBusinessId, month, sellerIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || sellerIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('seller_daily_earnings')
                .select('seller_id, date, commission_earned, delivered_count')
                .eq('DigiCom Business', activeBusinessId)
                .in('seller_id', sellerIds)
                .gte('date', bounds.from)
                .lte('date', bounds.to);
            if (error) throw error;
            return (data || []) as DailyEarning[];
        },
        enabled: !!activeBusinessId && sellerIds.length > 0,
    });

    const { data: priorPayments = [], isLoading: loadingPrior } = useQuery<PriorPayment[]>({
        queryKey: ['seller-earnings-prior', activeBusinessId, bounds.payoutMonthKey],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('seller_payments')
                .select('id, seller_id, payout_month, commission_earned, delivered_orders, total_amount, status, paid_at')
                .eq('DigiCom Business', activeBusinessId)
                .eq('payout_month', bounds.payoutMonthKey);
            if (error) throw error;
            return (data || []) as PriorPayment[];
        },
        enabled: !!activeBusinessId,
    });

    const rows = useMemo<SellerEarnings[]>(() => {
        // Bucket daily earnings by seller_id
        const dailyByS = new Map<string, DailyEarning[]>();
        for (const d of dailyEarnings) {
            const arr = dailyByS.get(d.seller_id) || [];
            arr.push(d);
            dailyByS.set(d.seller_id, arr);
        }

        // Bucket prior payments by seller_id
        const priorByS = new Map<string, PriorPayment[]>();
        for (const p of priorPayments) {
            const arr = priorByS.get(p.seller_id) || [];
            arr.push(p);
            priorByS.set(p.seller_id, arr);
        }

        return sellers.map<SellerEarnings>((s) => {
            const daily = dailyByS.get(s.id) || [];
            const prior = priorByS.get(s.id) || [];

            const month_commission = daily.reduce((a, r) => a + Number(r.commission_earned || 0), 0);
            const month_orders = daily.reduce((a, r) => a + Number(r.delivered_count || 0), 0);
            const month_days = new Set(daily.filter((r) => Number(r.commission_earned || 0) > 0).map((r) => r.date)).size;

            const prior_commission = prior.reduce((a, p) => a + Number(p.commission_earned || 0), 0);
            const prior_orders = prior.reduce((a, p) => a + Number(p.delivered_orders || 0), 0);

            const commission = Math.max(0, month_commission - prior_commission);
            const orders = Math.max(0, month_orders - prior_orders);

            let days_present = 0;
            if (commission > 0 || orders > 0) {
                if (month_commission > 0 && month_days > 0) {
                    days_present = Math.min(month_days, Math.max(1, Math.ceil((commission / month_commission) * month_days)));
                } else {
                    days_present = 1;
                }
            }

            const existing = prior[0] || null;
            return {
                seller_id: s.id,
                name: s.name,
                email: s.email,
                avatar_url: s.avatar_url,
                phone: s.phone,
                commission_price: Number(s.commission_price || 0),
                commission_basis: s.commission_basis,
                bank_name: s.bank_name,
                bank_account_holder: s.bank_account_holder,
                bank_rib: s.bank_rib,
                cin_number: s.cin_number,
                month_commission,
                month_orders,
                month_days,
                prior_commission,
                prior_orders,
                commission_earned: commission,
                delivered_orders: orders,
                days_present,
                salary_earned: 0,
                total_amount: commission,
                existing_payout: existing
                    ? {
                          id: existing.id,
                          status: existing.status,
                          total_amount: Number(existing.total_amount || 0),
                          paid_at: existing.paid_at,
                      }
                    : null,
            };
        });
    }, [sellers, dailyEarnings, priorPayments]);

    return {
        rows,
        payoutMonthKey: bounds.payoutMonthKey, // use this as the value for seller_payments.payout_month
        isLoading: loadingSellers || loadingDaily || loadingPrior,
    };
}
