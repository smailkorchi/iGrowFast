// Admin WhatsApp — Number detail page mount (page 1b). MANAGEMENT page =>
// IGF-themed (ant-surface / Tailwind), NOT the WA .wa-root look (reserved for
// the inbox). NumberDetail carries the ant-surface root. Rides IGF's supabase
// client, auth session and router; WaShell provides the WA-scoped QueryClient
// (tuned defaults + mutation-error toasts) and Toaster.
import NumberDetail from './routes/numbers/NumberDetail'
import WaShell from './WaShell'

export default function WhatsappNumberDetail() {
  return (
    <WaShell>
      <NumberDetail />
    </WaShell>
  )
}
