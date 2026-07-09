// Admin WhatsApp — Numbers page mount (page 1a). MANAGEMENT page => IGF-themed
// (ant-surface / Tailwind / shadcn), NOT the WA .wa-root look (that is reserved
// for the inbox). AdminNumbers itself carries the ant-surface root. Rides IGF's
// supabase client, auth session and router; WaShell provides the WA-scoped
// QueryClient (tuned defaults + mutation-error toasts) and Toaster.
import AdminNumbers from './routes/numbers/Numbers'
import WaShell from './WaShell'
import { AdminWaRealtime } from './lib/queries/waChannels'

export default function WhatsappNumbers() {
  return (
    <WaShell>
      <AdminWaRealtime />
      <AdminNumbers />
    </WaShell>
  )
}
