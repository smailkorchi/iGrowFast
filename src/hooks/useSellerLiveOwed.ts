import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useStatusCategories } from '@/hooks/useStatusCategories';
import {
    computeUnpaidCommission,
    normalizeCommissionBasis,
    isDeliveredForCommission,
} from '@/lib/commercialCommission';

// ═══════════════════════════════════════════════════════════════════════
// Per-seller LIVE owed — the single source of truth shared by the seller
// profile (collaborators/Sellers.tsx) and the Salaries pay flow, so the two
// pages can never drift. Mirrors the exact computation in Sellers.tsx:
//   accruedCash      = computeUnpaidCommission over live orders × current rate
//   paidAcrossRows   = Σ seller_payments.paid_amount (trigger-maintained from txns)
//   remaining        = unpaidCommission = max(0, accruedCash − paidAcrossRows)
// The Salaries payout rows are frozen monthly snapshots; this hook deliberately
// ignores their total_amount for the OWED figure and recomputes from `orders`
// so accrued-but-unbilled commission is never hidden.
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
    products: unknown;
};

const deriveStatus = (accrued: number, paid: number, remaining: number): LiveStatus => {
    if (accrued <= 0.005) return paid > 0 ? 'paid' : 'pending';
    if (remaining <= 0.005) return 'paid';
    if (paid > 0) return 'partial';
    return 'pending';
};

const getSellerProducts = (s: SellerUser): string[] =>
    Array.isArray(s.products)
        ? (s.products as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
        : [];

export function useSellerLiveOwed() {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const { deliveredPkgIds } = useStatusCategories();

    const { data: sellers = [], isLoading: lSellers } = useQuery<SellerUser[]>({
        queryKey: ['seller-live-owed-users', activeBusinessId],
        queryFn: async () => {
            if (!activeBusinessId) return [];
            const { data, error } = await (supabase as any)
                .from('users')
                .select('id, name, email, avatar_url, commission_price, commission_basis, products')
                .eq('DigiCom Business', activeBusinessId)
                .eq('role', 'commercial');
            if (error) throw error;
            return (data || []) as SellerUser[];
        },
        enabled: !!activeBusinessId,
    });

    const sellerIds = useMemo(() => sellers.map((s) => s.id), [sellers]);

    const { data: orders = [], isLoading: lOrders } = useQuery<any[]>({
        queryKey: ['seller-live-owed-orders', activeBusinessId, sellerIds.sort().join(',')],
        queryFn: async () => {
            if (!activeBusinessId || sellerIds.length === 0) return [];
            const { data, error } = await (supabase as any)
                .from('orders')
                .select('id, seller_id, package_status_id, order_items(product_id, quantity)')
                .in('seller_id', sellerIds)
                .is('date_deleted', null);
            if (error) throw error;
            return (data || []) as any[];
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
        const ordersByS = new Map<string, any[]>();
        for (const o of orders) {
            const a = ordersByS.get(o.seller_id) || [];
            a.push(o);
            ordersByS.set(o.seller_id, a);
        }
        const payByS = new Map<string, any[]>();
        for (const p of payments) {
            const a = payByS.get(p.seller_id) || [];
            a.push(p);
            payByS.set(p.seller_id, a);
        }

        const out = new Map<string, SellerLiveOwed>();
        for (const s of sellers) {
            const sOrders = ordersByS.get(s.id) || [];
            const sPays = payByS.get(s.id) || [];
            const price = Number(s.commission_price) || 0;
            const paidAcrossRows = sPays.reduce((sum, p) => sum + (Number(p.paid_amount) || 0), 0);

            // Identical inputs to collaborators/Sellers.tsx so the two pages match.
            const { accruedTotal: accruedCount, unpaidCommission } = computeUnpaidCommission({
                basis: normalizeCommissionBasis(s.commission_basis),
                commissionPrice: price,
                orders: sOrders,
                isDelivered: (o: any) => isDeliveredForCommission(o, deliveredPkgIds),
                sellerProductIds: getSellerProducts(s),
                paidAmount: paidAcrossRows,
            });
            // computeUnpaidCommission returns accruedTotal as a COUNT (units for
            // per_unit, orders for per_order); convert to cash like the lib does.
            const accruedCash = accruedCount * price;

            out.set(s.id, {
                seller_id: s.id,
                name: s.name || '—',
                email: s.email || '',
                avatar_url: s.avatar_url,
                commissionPrice: price,
                commissionBasis: normalizeCommissionBasis(s.commission_basis),
                deliveredCount: Math.round(accruedCount),
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
    }, [sellers, orders, payments, deliveredPkgIds]);

    const all = useMemo(() => Array.from(map.values()), [map]);

    return {
        byId: (sellerId: string): SellerLiveOwed | null => map.get(sellerId) || null,
        all,
        /** Σ remaining across every commercial — true outstanding payroll. */
        totalRemaining: all.reduce((s, o) => s + o.remaining, 0),
        loaded: !lSellers && !lOrders && !lPay,
        isLoading: lSellers || lOrders || lPay,
    };
}
