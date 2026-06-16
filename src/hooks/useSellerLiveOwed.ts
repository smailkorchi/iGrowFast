import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase, fetchAllRows } from '@/lib/supabase';
import { normalizeCommissionBasis } from '@/lib/commercialCommission';

// ═══════════════════════════════════════════════════════════════════════
// Per-seller LIVE owed — the single source of truth shared by the seller
// profile (collaborators/Sellers.tsx) and the Salaries pay flow, so the two
// pages can never drift.
//
// Accrual is read from the server-computed view public.seller_daily_earnings
// — the SAME source that backs the seller dashboard commission and the
// "Generate payouts" flow. It is NOT recomputed client-side from a capped
// orders fetch. The previous implementation aggregated `orders` with a bare
// `.select()` (no pagination) which silently truncated at PostgREST's 1000-row
// default and undercounted any high-volume seller (e.g. ghita: 5230 instead of
// the true 6370). Reading the view removes that cap entirely.
//
//   accruedCash    = Σ seller_daily_earnings.commission_earned  (current rate × delivered units/orders)
//   deliveredCount = Σ seller_daily_earnings.delivered_count    (units for per_unit, orders for per_order)
//   paidAcrossRows = Σ seller_payments.paid_amount              (trigger-maintained from txns)
//   remaining      = max(0, accruedCash − paidAcrossRows)
// The Salaries payout rows are frozen monthly snapshots; this hook deliberately
// ignores their total_amount for the OWED figure and uses the live view so
// accrued-but-unbilled commission is never hidden.
// ═══════════════════════════════════════════════════════════════════════

export type LiveStatus = 'pending' | 'partial' | 'paid';

export type SellerLiveOwed = {
    seller_id: string;
    name: string;
    email: string;
    avatar_url: string | null;
    commissionPrice: number;
    commissionBasis: string;
    /** billable delivered count (units for per_unit, orders for per_order) */
    deliveredCount: number;
    /** live accrued commission cash (current commission_price × delivered units/orders) */
    accruedTotal: number;
    /** Σ seller_payments.paid_amount across ALL of this seller's payout rows */
    paidAcrossRows: number;
    /** max(0, accruedTotal − paidAcrossRows) — matches the profile's UNPAID COMMISSION */
    remaining: number;
    /** live-derived status from accrued vs paid (not the frozen row status) */
    status: LiveStatus;
    /** this seller's payout rows (for canonical-row resolution at pay time) */
    paymentRows: { id: string; payout_month: string; total_amount: number; paid_amount: number }[];
};

type SellerUser = {
    id: string;
    name: string | null;
    email: string | null;
    avatar_url: string | null;
    commission_price: number | null;
    commission_basis: string | null;
};

type DailyEarning = {
    seller_id: string | null;
    commission_earned: number | string | null;
    delivered_count: number | string | null;
};

const deriveStatus = (accrued: number, paid: number, remaining: number): LiveStatus => {
    if (accrued <= 0.005) return paid > 0 ? 'paid' : 'pending';
    if (remaining <= 0.005) return 'paid';
    if (paid > 0) return 'partial';
    return 'pending';
};

export function useSellerLiveOwed() {
    const activeBusinessId = localStorage.getItem('activeBusinessId');

    const { data: sellers = [], isLoading: lSellers } = useQuery<SellerUser[]>({
        queryKey: ['seller-live-owed-users', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, email, avatar_url, commission_price, commission_basis')
                .eq('DigiCom Business', activeBusinessId)
                .eq('role', 'commercial');
            if (error) throw error;
            return (data || []) as SellerUser[];
        },
        enabled: !!activeBusinessId,
    });

    const sellerIds = useMemo(() => sellers.map((s) => s.id), [sellers]);

    // Server-computed accrual from the seller_daily_earnings view (uncapped via
    // paginated fetchAllRows — a view spanning many days × sellers can itself
    // exceed 1000 rows).
    const { data: dailyEarnings = [], isLoading: lDaily } = useQuery<DailyEarning[]>({
        queryKey: ['seller-live-owed-daily', activeBusinessId, sellerIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || sellerIds.length === 0) return [];
            return await fetchAllRows<DailyEarning>(
                'seller_daily_earnings',
                'seller_id, commission_earned, delivered_count',
                {
                    orderBy: 'id',
                    filters: [
                        { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
                        { column: 'seller_id', op: 'in', value: sellerIds },
                    ],
                },
            );
        },
        enabled: !!activeBusinessId && sellerIds.length > 0,
    });

    const { data: payments = [], isLoading: lPay } = useQuery<any[]>({
        queryKey: ['seller-live-owed-payments', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('seller_payments')
                .select('id, seller_id, payout_month, total_amount, paid_amount')
                .eq('DigiCom Business', activeBusinessId);
            if (error) throw error;
            return (data || []) as any[];
        },
        enabled: !!activeBusinessId,
    });

    const map = useMemo(() => {
        // Bucket view accrual by seller_id.
        const accrualByS = new Map<string, { cash: number; count: number }>();
        for (const d of dailyEarnings) {
            const sid = d.seller_id;
            if (!sid) continue;
            const prev = accrualByS.get(sid) || { cash: 0, count: 0 };
            prev.cash += Number(d.commission_earned || 0);
            prev.count += Number(d.delivered_count || 0);
            accrualByS.set(sid, prev);
        }

        const payByS = new Map<string, any[]>();
        for (const p of payments) {
            const a = payByS.get(p.seller_id) || [];
            a.push(p);
            payByS.set(p.seller_id, a);
        }

        const out = new Map<string, SellerLiveOwed>();
        for (const s of sellers) {
            const accrual = accrualByS.get(s.id) || { cash: 0, count: 0 };
            const sPays = payByS.get(s.id) || [];
            const price = Number(s.commission_price) || 0;
            const paidAcrossRows = sPays.reduce((sum, p) => sum + (Number(p.paid_amount) || 0), 0);

            const accruedCash = accrual.cash;
            const unpaidCommission = Math.max(0, accruedCash - paidAcrossRows);

            out.set(s.id, {
                seller_id: s.id,
                name: s.name || '—',
                email: s.email || '',
                avatar_url: s.avatar_url,
                commissionPrice: price,
                commissionBasis: normalizeCommissionBasis(s.commission_basis),
                deliveredCount: Math.round(accrual.count),
                accruedTotal: accruedCash,
                paidAcrossRows,
                remaining: unpaidCommission,
                status: deriveStatus(accruedCash, paidAcrossRows, unpaidCommission),
                paymentRows: sPays.map((p) => ({
                    id: p.id,
                    payout_month: p.payout_month,
                    total_amount: Number(p.total_amount) || 0,
                    paid_amount: Number(p.paid_amount) || 0,
                })),
            });
        }
        return out;
    }, [sellers, dailyEarnings, payments]);

    const all = useMemo(() => Array.from(map.values()), [map]);

    return {
        byId: (sellerId: string): SellerLiveOwed | null => map.get(sellerId) || null,
        all,
        /** Σ remaining across every commercial — true outstanding payroll. */
        totalRemaining: all.reduce((s, o) => s + o.remaining, 0),
        loaded: !lSellers && !lDaily && !lPay,
        isLoading: lSellers || lDaily || lPay,
    };
}
