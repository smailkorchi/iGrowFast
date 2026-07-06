// Shared shell for all WhatsApp-module pages.
//
// Provides the two WA Mancer app-root facilities the pages were built
// against, scoped to this module so IGF's global QueryClient stays untouched:
//   1. waQueryClient — WA Mancer's tuned TanStack defaults (staleTime 15s,
//      retry 1, focus/reconnect refetch) + the global MutationCache error
//      toast (meta.silent opt-out). Module-level singleton, so the cache
//      survives navigation between WA pages.
//   2. Toaster — WA Mancer's toast renderer; without it every failed
//      mutation on these pages would be silent.
import { QueryClientProvider } from '@tanstack/react-query'
import { waQueryClient } from './lib/queryClient'
import Toaster from './lib/toast/Toaster'

export default function WaShell({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={waQueryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  )
}
