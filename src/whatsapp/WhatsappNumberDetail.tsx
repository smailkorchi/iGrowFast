// Admin WhatsApp — Number detail page mount (page 1b). MANAGEMENT page =>
// IGF-themed (ant-surface / Tailwind), NOT the WA .wa-root look (reserved for
// the inbox). NumberDetail carries the ant-surface root. Rides IGF's supabase
// client, auth session and router; WaShell provides the WA-scoped QueryClient
// (tuned defaults + mutation-error toasts) and Toaster.
import NumberDetail from './routes/numbers/NumberDetail'
import WaShell from './WaShell'
import { AdminWaRealtime } from './lib/queries/waChannels'

export default function WhatsappNumberDetail() {
  return (
    <WaShell>
      <AdminWaRealtime />
      <NumberDetail />
    </WaShell>
  )
}
