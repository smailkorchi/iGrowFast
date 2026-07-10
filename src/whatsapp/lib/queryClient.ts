// WA-module TanStack Query client — 1:1 from WA Mancer src/lib/queryClient.ts.
//
// Scoped to the WhatsApp module (mounted by WaShell) instead of replacing
// IGF's global QueryClient: the rest of the admin app assumes the bare
// defaults; the WA pages were tuned around these.
//
// The defaults below are deliberately conservative:
//
// - `staleTime: 15s` — fresh enough that fast navigations between pages serve
//   the cache instantly without a network hit, short enough that returning to
//   a backgrounded tab triggers a refetch on the next focus event.
// - `gcTime: 5min` — unused queries stay in cache for 5 minutes after the
//   last component unsubscribed. Cheap memory; fast back-nav.
// - `refetchOnWindowFocus: true` — when the user comes back to a tab that
//   was backgrounded, every visible query refetches. This is the ONLY
//   reliable cure for "I had to refresh the page to see the data."
//   Without it, realtime invalidations queued while the tab was hidden
//   don't fire (browsers throttle background timers), and the cache shows
//   stale data forever.
// - `refetchOnReconnect: true` — same reasoning for network drops.
// - `refetchOnMount: true` — on first mount of a component subscribing to a
//   query whose data is stale, refetch. (NOT `'always'`: we trust staleTime.)
// - `retry: 1` — one retry on transient failure. More on a 4xx is just waste.

import { MutationCache, QueryClient } from '@tanstack/react-query'
import { normalizeError, toast } from './toast/store'
import { supabase } from './supabase'

export const waQueryClient = new QueryClient({
  // Baseline error feedback for EVERY useMutation: a failed mutation auto-shows a toast.
  // Fires IN ADDITION to hook-level / per-call onError (React Query v5), so opt a mutation
  // out with `meta: { silent: true }` when it renders its own inline error (modals, etc.).
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if ((mutation.meta as { silent?: boolean } | undefined)?.silent) return
      toast.error(normalizeError(error))
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

// The WA channels (waChannels) now live for the whole session in the layouts,
// and this client is a module singleton — after a same-tab account switch the
// previous user's instances would be served stale-while-revalidating and
// wa:biz could transiently subscribe the OLD business with the NEW token.
// Purge everything on sign-out.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') waQueryClient.clear()
})
