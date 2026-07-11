// E-commerce realtime seam (W7 foundation) — consumer side.
//
// Subscribes ONE private ecom:biz:<business_id> broadcast channel per inbox
// client and turns 'order' events (emitted by the public.broadcast_order_change
// trigger, mig 20260711160000) into targeted react-query invalidations of the
// chat-header order-history queries (queries/customerOrders.ts). This keeps the
// button's count + dropdown live when an order is created/changed for the open
// customer — WITHOUT a postgres_changes firehose, matching the WhatsApp side's
// broadcast discipline. Same authz shape as wa:biz (private + a realtime.messages
// SELECT policy), but readable by ANY business member (admins + sellers) because
// the order history is business-wide.
//
// Runs under the WA module's waQueryClient (mounted inside WaShell), which is
// exactly where the ['chat-orders', …] queries live.

import { useEffect } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { useInstances } from './instances'

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

/** One ecom:biz channel per client. Mount once inside the inbox. */
export function useEcomBizChannel(businessId: string | null): void {
  const qc = useQueryClient()
  useEffect(() => {
    if (!businessId) return
    let hadError = false
    const ch = supabase
      .channel(`ecom:biz:${businessId}`, { config: { private: true } })
      .on('broadcast', { event: 'order' }, ({ payload }) => {
        const phone = (payload as { phone?: string | null } | null)?.phone ?? null
        invalidateChatOrders(qc, phone)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Broadcast is at-most-once: anything missed while the socket was
          // down self-heals on reconnect.
          if (hadError) { hadError = false; invalidateChatOrders(qc, null) }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          hadError = true
        }
      })
    return () => { void supabase.removeChannel(ch) }
  }, [businessId, qc])
}

/**
 * Mounter — resolves the business id from the (RLS-scoped) instances cache and
 * opens the single ecom:biz channel. Works for admins AND sellers: both have at
 * least one assigned instance while the inbox is open, and instances carry
 * business_id. No-ops until the id resolves.
 */
export function EcomBizRealtime(): null {
  const { data: instances } = useInstances()
  useEcomBizChannel(instances?.[0]?.business_id ?? null)
  return null
}
