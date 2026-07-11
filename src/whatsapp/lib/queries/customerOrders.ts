// IGF ADDITION (e-commerce seam): customer order history for the chat header
// (admin + seller inboxes).
//
// These hooks call PUBLIC-schema RPCs through the MAIN app supabase client
// ('@/lib/supabase') — NOT the whatsapp-module client. Both RPCs are
// SECURITY DEFINER, derive the business from the caller and are role-gated
// (admin/seller) server-side:
//
//   chat_customer_orders_count(p_phone text) -> integer
//   chat_customer_orders_page(p_phone text, p_limit int, p_offset int) -> rows
//
// p_phone is the digits of the WhatsApp remote_jid (canonical '212…'); the
// RPC normalizes further.
//
// COST RULES (hard):
//   - the count fires only while a thread is open (the chat header is
//     mounted), NEVER per conversation-list row;
//   - the page fires only while the dropdown is open (`enabled` flag).
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface CustomerOrderRow {
  id: string
  name: string | null
  price: number | null
  order_date: string | null
  order_status_label: string | null
  order_status_color: string | null
  order_status_icon: string | null
  package_status_label: string | null
  package_status_color: string | null
  package_status_icon: string | null
  product_name: string | null
  product_image: string | null
  extra_items: number | null
  seller_id: string | null
}

export const CUSTOMER_ORDERS_PAGE = 20

// The chat_customer_orders_* RPCs are newer than the generated Database
// types — call through an untyped rpc seam (same convention as the
// seller_month_orders call sites in the main app).
type RpcResult = { data: unknown; error: { message: string } | null }
const rpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<RpcResult>

/**
 * Order count for the header button badge. Errors resolve to 0 — the button
 * just stays gray; no toast.
 */
export function useCustomerOrdersCount(phoneDigits: string | null) {
  return useQuery<number>({
    queryKey: ['chat-orders', 'count', phoneDigits ?? '_'],
    queryFn: async () => {
      try {
        const { data, error } = await rpc('chat_customer_orders_count', {
          p_phone: phoneDigits!,
        })
        if (error) return 0
        return typeof data === 'number' ? data : 0
      } catch {
        return 0
      }
    },
    enabled: !!phoneDigits,
    staleTime: 120_000,
  })
}

/**
 * Paged order history for the dropdown. `enabled` MUST be the dropdown-open
 * flag — pages fetch only while the panel is open.
 */
export function useCustomerOrdersPage(phoneDigits: string | null, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['chat-orders', 'page', phoneDigits ?? '_'],
    queryFn: async ({ pageParam }) => {
      const { data, error } = await rpc('chat_customer_orders_page', {
        p_phone: phoneDigits!,
        p_limit: CUSTOMER_ORDERS_PAGE,
        p_offset: pageParam,
      })
      if (error) throw new Error(error.message)
      return {
        rows: (data ?? []) as CustomerOrderRow[],
        offset: pageParam,
      }
    },
    initialPageParam: 0,
    // "Voir plus" exists exactly while the last page came back full.
    getNextPageParam: (last) =>
      last.rows.length === CUSTOMER_ORDERS_PAGE ? last.offset + CUSTOMER_ORDERS_PAGE : undefined,
    enabled: !!phoneDigits && enabled,
    staleTime: 60_000,
    // Point-in-time history: a focus refetch would replay EVERY loaded page
    // (N+1 RPCs after N "Voir plus" clicks). The count badge stays the live
    // signal; reopening the dropdown past staleTime refreshes naturally.
    refetchOnWindowFocus: false,
  })
}
