import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

// ═══════════════════════════════════════════════════════════════════════
// Media buyer monthly earnings — server-side (D5 ④ `mb_roster_earnings`).
// ═══════════════════════════════════════════════════════════════════════
// Returns, for a given YYYY-MM month and the active business, the earnings of
// every media buyer in the business (or only the caller's own row when
// `selfMbId` is passed). Consumed by:
//
//   src/pages/admin/collaborators/MediaBuyers.tsx  (admin, roster)
//   src/pages/admin/Salaries.tsx                   (admin, bulk payout preview)
//   src/pages/mediabuyer/Payments.tsx              (MB, SELF — passes selfMbId)
//
// ── D5: the payroll math moved to the DB ───────────────────────────────
// This hook used to be a SECOND, DRIFTING implementation of the payroll
// formula: a 3-deep query waterfall (users → mbIds → campaign_daily_entries →
// sourceList → orders, + priorPayments in parallel; none with a staleTime, so
// the whole chain re-ran serially on every mount AND every window focus) whose
// result also backed the Salaries bulk-payout generator. `mb_month_earned` —
// the cron/ledger payout AUTHORITY — computed the same figures a different
// way. `mb_roster_earnings` is that authority's body made set-returning, so
// the drift is retired: one formula for the ledger and the leaderboard.
//
// The RPC's gate is self-or-admin (`admin OR p_mb = auth.uid()`), which is why
// the MB-self path MUST pass `selfMbId` — see the enablement note below.
//
// ── What is still client-side, and why ─────────────────────────────────
// The RPC projects NO user PII (no name/email/avatar/phone/bank_*/cin/address)
// — that is what keeps peers' banking and salary out of a self-caller's
// payload BY CONSTRUCTION. The `users` query below supplies those columns and
// is joined to the RPC's money rows by id, client-side: the same seam
// `Couriers.tsx` already uses for `courier_roster_stats`.
//
// ── Replicated client bugs (owner ruling pending — do NOT "fix" here) ──
// `prior_paid_amount` / `remaining_amount` / `existing_payout` are computed in
// the RPC bug-for-bug with the client this replaced (D5-BUG-1 + D5-BUG-2):
// the month predicate uses the raw 'YYYY-MM' string against a payout_month
// column that stores 'YYYY-MM-01' (⇒ matches 0 rows, always ⇒
// prior_paid_amount ≡ 0, existing_payout ≡ null, remaining_amount ≡
// total_amount), and it sums `total_amount` rather than `paid_amount`.
// Rationale, correct semantics and the double-pay blast radius are documented
// in supabase/migrations/20260715030000_d5_leaderboards.sql (header, ④).
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
    // Computed for this month (server-side)
    delivered_orders: number;
    total_spend: number;
    campaigns_count: number;
    salary_earned: number;
    commission_earned: number;
    total_amount: number; // what SHOULD be paid this month
    prior_paid_amount: number; // already paid for this month
    remaining_amount: number; // total_amount - prior_paid_amount (floor 0)
    // Lifetime campaigns the buyer OWNS (created_by) — folds the roster page's
    // own `campaigns` tally query. Deliberately NOT the month-scoped
    // campaigns_count, which is 0 in a month with no spend rows.
    owned_campaign_count: number;
    // Payout row if one already exists for (mediabuyer_id, month)
    existing_payout: {
        id: string;
        status: 'pending' | 'partial' | 'paid';
        total_amount: number;
        paid_amount: number;
        paid_at: string | null;
    } | null;
};

/** Lifetime payout rows, business-wide (narrowed to the MB on the self path). */
export type MediaBuyerPayout = {
    id: string;
    mediabuyer_id: string;
    payout_month: string;
    total_amount: number;
    paid_amount: number;
    delivered_orders: number;
    status: 'pending' | 'partial' | 'paid';
    paid_at: string | null;
    created_at: string;
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

/** Money row of the server-side aggregate (mb_roster_earnings RPC). */
type RosterEarningRow = {
    mediabuyer_id: string;
    delivered_orders: number | string;
    total_spend: number | string;
    campaigns_count: number | string;
    salary_earned: number | string;
    commission_earned: number | string;
    total_amount: number | string;
    prior_paid_amount: number | string;
    remaining_amount: number | string;
    owned_campaign_count: number | string;
    existing_payout: {
        id: string;
        status: 'pending' | 'partial' | 'paid';
        total_amount: number | string;
        paid_amount: number | string;
        paid_at: string | null;
    } | null;
};

type RosterPayoutRow = Omit<MediaBuyerPayout, 'total_amount' | 'paid_amount' | 'delivered_orders'> & {
    total_amount: number | string;
    paid_amount: number | string;
    delivered_orders: number | string;
};

type RosterPayload = {
    mediabuyers: RosterEarningRow[];
    payouts: RosterPayoutRow[];
};

const EMPTY_PAYLOAD: RosterPayload = { mediabuyers: [], payouts: [] };

// `selfMbId` narrows BOTH the fetch and the RPC to a single media buyer's own
// row. The MB Dashboard/Payments surfaces only ever display the current user's
// own earnings (they `.find(r => r.mediabuyer_id === currentUserId)`), so
// passing the caller's id keeps peers' banking/salary/PII columns out of the
// client's projection (need-to-know) — and it is what satisfies the RPC's
// self-or-admin gate for a non-admin caller. Admin pages omit `opts` entirely
// and get every media buyer.
export function useMediaBuyerEarnings(month: string, opts?: { selfMbId?: string | null }) {
    const activeBusinessId = localStorage.getItem('activeBusinessId');
    const selfMbId = opts?.selfMbId ?? null;
    // Passing `opts` at all = "I am a self-scoped caller". Such a caller is not
    // necessarily an admin, so firing with p_mb = null would trip the RPC's
    // self-or-admin gate (42501) during the tick before its own id resolves.
    // Hold the queries instead and keep reporting `isLoading`.
    const selfScoped = opts !== undefined;
    const selfPending = selfScoped && !selfMbId;
    const ready = !!activeBusinessId && !selfPending;

    // 1. Media buyers in business (self only when selfMbId is set) — PII the
    //    RPC deliberately does not project.
    const {
        data: mediabuyers = [],
        isLoading: loadingMBs,
        isError: errorMBs,
        refetch: refetchMBs,
    } = useQuery<MBUser[]>({
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
        enabled: ready,
    });

    // 2. The month's payroll + the lifetime payout list, in ONE call. Replaces
    //    the 4-query waterfall (users → entries → orders → priorPayments) and
    //    folds the roster page's own lifetime `mediabuyer_payments` select.
    const {
        data: payload = EMPTY_PAYLOAD,
        isLoading: loadingRoster,
        isError: errorRoster,
        refetch: refetchRoster,
    } = useQuery<RosterPayload>({
        queryKey: ['mb-roster-earnings', activeBusinessId, month, selfMbId ?? 'all'],
        queryFn: async () => {
            if (!activeBusinessId) return EMPTY_PAYLOAD;
            const { data, error } = await (supabase as any).rpc('mb_roster_earnings', {
                p_business: activeBusinessId,
                p_month: month,
                p_mb: selfMbId,
            });
            if (error) throw error;
            return (data || EMPTY_PAYLOAD) as RosterPayload;
        },
        enabled: ready,
    });

    // 3. Join the money rows onto the roster by id. Driving from `users` (not
    //    from the RPC array) preserves the row set AND the order this hook has
    //    always returned; a buyer with no rows overlays as zeros, exactly like
    //    the old client-side compute produced for an empty entry bucket.
    const rows = useMemo<MediaBuyerEarnings[]>(() => {
        const byId = new Map<string, RosterEarningRow>();
        for (const r of payload.mediabuyers ?? []) byId.set(r.mediabuyer_id, r);

        return mediabuyers.map<MediaBuyerEarnings>((u) => {
            const s = byId.get(u.id);
            const existing = s?.existing_payout ?? null;
            return {
                mediabuyer_id: u.id,
                name: u.name,
                email: u.email,
                avatar_url: u.avatar_url,
                avatar_config: u.avatar_config ?? null,
                phone: u.phone,
                payment_type: u.payment_type,
                commission_price: Number(u.commission_price || 0),
                salary_amount: Number(u.salary_amount || 0),
                bank_name: u.bank_name,
                bank_account_holder: u.bank_account_holder,
                bank_rib: u.bank_rib,
                cin_number: u.cin_number,
                address: u.address ?? null,
                created_at: u.created_at ?? null,
                currency: 'MAD',
                delivered_orders: Number(s?.delivered_orders || 0),
                total_spend: Number(s?.total_spend || 0),
                campaigns_count: Number(s?.campaigns_count || 0),
                salary_earned: Number(s?.salary_earned || 0),
                commission_earned: Number(s?.commission_earned || 0),
                total_amount: Number(s?.total_amount || 0),
                prior_paid_amount: Number(s?.prior_paid_amount || 0),
                remaining_amount: Number(s?.remaining_amount || 0),
                owned_campaign_count: Number(s?.owned_campaign_count || 0),
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
    }, [mediabuyers, payload]);

    // Lifetime payouts (business-wide for admins, own-only on the self path).
    const payouts = useMemo<MediaBuyerPayout[]>(
        () =>
            (payload.payouts ?? []).map((p) => ({
                ...p,
                total_amount: Number(p.total_amount || 0),
                paid_amount: Number(p.paid_amount || 0),
                delivered_orders: Number(p.delivered_orders || 0),
            })),
        [payload],
    );

    return {
        rows,
        payouts,
        isLoading: selfPending || loadingMBs || loadingRoster,
        isError: errorMBs || errorRoster,
        refetch: () => {
            refetchMBs();
            refetchRoster();
        },
    };
}
