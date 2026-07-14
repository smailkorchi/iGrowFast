// E-commerce realtime bridge for the WA inbox (W7 R1a).
//
// The private ecom:biz:<business_id> broadcast channel is owned by the
// layout-mounted <EcomBizRealtime/> (src/components/realtime/EcomBizRealtime.tsx)
// — AppLayout wraps the admin inbox and SellerLayout the seller inbox, so the
// channel is always live while this module is mounted. Opening a SECOND
// channel on the same topic here would collide (Phoenix replaces same-topic
// joins on the shared socket), so this bridge consumes the in-app ecomBus
// instead and turns 'order' events into targeted invalidations of the
// chat-header order-history queries (queries/customerOrders.ts).
//
// Runs under the WA module's waQueryClient (mounted inside WaShell), which is
// exactly where the ['chat-orders', …] queries live.

import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { subscribeEcomBus } from '@/lib/ecomBus'

function invalidateChatOrders(qc: QueryClient, phone: string | null): void {
  if (phone) {
    // Targeted: only the open customer's count/page refetch (the key uses the
    // canonical 212… digits — same value normalize_phone_for_customer emits).
    void qc.invalidateQueries({ queryKey: ['chat-orders', 'count', phone] })
    void qc.invalidateQueries({ queryKey: ['chat-orders', 'page', phone] })
  } else {
    void qc.invalidateQueries({ queryKey: ['chat-orders'] })
  }
}

/**
 * Bridge — mount once inside each inbox (admin Conversations, seller Whatsapp).
 * 'order' → targeted chat-orders invalidation; 'reconnect' (the layout channel
 * re-subscribed after an error) → broad reconciliation, since broadcast is
 * at-most-once.
 */
export function ChatOrdersBridge(): null {
  const qc = useQueryClient()
  useEffect(() => subscribeEcomBus((event) => {
    if (event.type === 'order') {
      invalidateChatOrders(qc, event.payload.phone ?? null)
    } else if (event.type === 'reconnect') {
      invalidateChatOrders(qc, null)
    }
  }), [qc])
  return null
}
