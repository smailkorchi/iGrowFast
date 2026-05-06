import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { format } from 'date-fns';

export interface SellerCommissionTotals {
  /** seller_id -> sum of commission_earned from seller_daily_earnings in window */
  totals: Map<string, number>;
  /** seller_id -> sum of delivered_count in window */
  deliveredTotals: Map<string, number>;
}

/**
 * Reads public.seller_daily_earnings — the server-computed source of truth that
 * drives payouts — filtered to the given business and date window.
 *
 * Returned maps are keyed by seller_id; callers lookup their seller(s) directly.
 * When `from`/`to` are undefined, the window is unbounded on that side.
 */
export function useSellerCommissionTotals(
  businessId: string | null | undefined,
  from: Date | undefined,
  to: Date | undefined,
) {
  const fromKey = from ? format(from, 'yyyy-MM-dd') : 'none';
  const toKey = to ? format(to, 'yyyy-MM-dd') : 'none';

  return useQuery<SellerCommissionTotals>({
    queryKey: ['seller-daily-earnings-totals', businessId, fromKey, toKey],
    queryFn: async () => {
      const totals = new Map<string, number>();
      const deliveredTotals = new Map<string, number>();
      if (!businessId) return { totals, deliveredTotals };

      let q = supabase
        .from('seller_daily_earnings')
        .select('seller_id, date, commission_earned, delivered_count')
        .eq('DigiCom Business', businessId);

      if (from) q = q.gte('date', format(from, 'yyyy-MM-dd'));
      if (to) q = q.lte('date', format(to, 'yyyy-MM-dd'));

      const { data, error } = await q;
      if (error) throw error;

      for (const row of data || []) {
        const sid = row.seller_id as string | null;
        if (!sid) continue;
        totals.set(sid, (totals.get(sid) || 0) + Number(row.commission_earned || 0));
        deliveredTotals.set(sid, (deliveredTotals.get(sid) || 0) + Number(row.delivered_count || 0));
      }
      return { totals, deliveredTotals };
    },
    enabled: !!businessId,
    staleTime: 60 * 1000,
  });
}
