import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAllRows } from '@/lib/supabase';

// ═══════════════════════════════════════════════════════════════════════
// Rolling monthly payout ledger — the single source of truth for seller
// payouts on BOTH the admin Salaries page and the seller Payments page.
//
// Backed by public.seller_ledger (seller_payments + remaining), maintained by
// the DB lifecycle (close_seller_month cron + refresh_open_seller_ticket +
// pay_seller). One ticket per (seller, month):
//   • OPEN ticket  = current month, live (month_earned re-synced from the view).
//   • CLOSED ticket = past month, frozen snapshot.
//   • total_amount = carried_in + month_earned ; remaining = total_amount − paid_amount.
//   • Unpaid balance rolls forward via carried_in, so the OPEN ticket's
//     `remaining` is the seller's true total owed (= lifetime earned − paid).
// ═══════════════════════════════════════════════════════════════════════

export type LedgerTicket = {
  id: string;
  seller_id: string;
  payout_month: string;          // 'YYYY-MM-01'
  period_state: 'open' | 'closed';
  carried_in: number;
  month_earned: number;
  total_amount: number;
  paid_amount: number;
  remaining: number;
  carried_out: number | null;
  delivered_orders: number;      // units this month (per_unit) / orders (per_order)
  status: 'pending' | 'partial' | 'paid';
  closed_at: string | null;
  paid_at: string | null;
};

export type SellerLedger = {
  seller_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  avatar_config: unknown | null;
  commissionPrice: number;
  commissionBasis: string | null;
  open: LedgerTicket | null;          // current-month ticket
  closed: LedgerTicket[];             // finalized months, newest first
  lifetimeEarned: number;            // Σ month_earned across all tickets
  lifetimePaid: number;              // Σ paid_amount across all tickets
  owe: number;                       // open.remaining (true outstanding; ≥ may be < 0 = credit)
};

type SellerUser = {
  id: string; name: string | null; email: string | null; avatar_url: string | null; avatar_config: unknown | null;
  commission_price: number | null; commission_basis: string | null;
};

const num = (v: unknown) => Number(v ?? 0) || 0;

export function useSellerLedger() {
  const activeBusinessId = localStorage.getItem('activeBusinessId');

  const { data: sellers = [], isLoading: lSellers } = useQuery<SellerUser[]>({
    queryKey: ['seller-ledger-users', activeBusinessId],
    queryFn: async () =>
      activeBusinessId
        ? await fetchAllRows<SellerUser>('users', 'id, name, email, avatar_url, avatar_config, commission_price, commission_basis', {
            filters: [
              { column: 'DigiCom Business', op: 'eq', value: activeBusinessId },
              { column: 'role', op: 'eq', value: 'commercial' },
            ],
          })
        : [],
    enabled: !!activeBusinessId,
  });

  const { data: tickets = [], isLoading: lTickets } = useQuery<LedgerTicket[]>({
    queryKey: ['seller-ledger-tickets', activeBusinessId],
    queryFn: async () =>
      activeBusinessId
        ? await fetchAllRows<LedgerTicket>(
            'seller_ledger',
            'id, seller_id, payout_month, period_state, carried_in, month_earned, total_amount, paid_amount, remaining, carried_out, delivered_orders, status, closed_at, paid_at',
            { filters: [{ column: 'DigiCom Business', op: 'eq', value: activeBusinessId }], orderBy: 'payout_month' },
          )
        : [],
    enabled: !!activeBusinessId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const map = useMemo(() => {
    const byS = new Map<string, LedgerTicket[]>();
    for (const t of tickets) {
      const arr = byS.get(t.seller_id) || [];
      arr.push({
        ...t,
        carried_in: num(t.carried_in), month_earned: num(t.month_earned),
        total_amount: num(t.total_amount), paid_amount: num(t.paid_amount),
        remaining: num(t.remaining), carried_out: t.carried_out == null ? null : num(t.carried_out),
        delivered_orders: num(t.delivered_orders),
      });
      byS.set(t.seller_id, arr);
    }
    const out = new Map<string, SellerLedger>();
    for (const s of sellers) {
      const rows = byS.get(s.id) || [];
      // NEWEST open ticket. `rows` is payout_month-ASCENDING (fetchAllRows defaults to
      // ascending), so a bare .find() took the OLDEST — disagreeing with the statement PDF,
      // which already picks the newest (sendPayoutStatement.ts: period_state=open, payout_month
      // DESC, limit 1). Normally there is exactly one open ticket per seller and the two agree,
      // but close_seller_month CONTINUEs past an all-zero ticket (earned=0 AND carried_in=0 AND
      // paid=0), leaving that month open forever for a seller who earned nothing. If such a
      // seller later earns, the close cron opens a SECOND ticket while the stale zero one stays
      // open — and picking the oldest would bind the whole page to the zero: `owe` reads 0, the
      // Pay button disappears (isSettleable needs remaining > 0.005), and the ticket holding the
      // real money is dropped from the roster, since it is neither `open` nor in `closed`.
      const open = rows
        .filter((r) => r.period_state === 'open')
        .sort((a, b) => b.payout_month.localeCompare(a.payout_month))[0] || null;
      const closed = rows
        .filter((r) => r.period_state === 'closed')
        .sort((a, b) => b.payout_month.localeCompare(a.payout_month));
      out.set(s.id, {
        seller_id: s.id,
        name: s.name || '—',
        email: s.email || '',
        avatar_url: s.avatar_url,
        avatar_config: s.avatar_config ?? null,
        commissionPrice: num(s.commission_price),
        commissionBasis: s.commission_basis,
        open,
        closed,
        lifetimeEarned: rows.reduce((a, r) => a + r.month_earned, 0),
        lifetimePaid: rows.reduce((a, r) => a + r.paid_amount, 0),
        owe: open ? open.remaining : 0,
      });
    }
    return out;
  }, [sellers, tickets]);

  const all = useMemo(() => Array.from(map.values()), [map]);

  return {
    byId: (sellerId: string): SellerLedger | null => map.get(sellerId) || null,
    all,
    /** sellers who currently owe money (owe > 0) */
    owing: all.filter((s) => s.owe > 0.005),
    totalOwed: all.reduce((s, x) => s + Math.max(0, x.owe), 0),
    totalPaid: all.reduce((s, x) => s + x.lifetimePaid, 0),
    isLoading: lSellers || lTickets,
  };
}
