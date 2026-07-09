// Admin WhatsApp — Assignment page mount (page 5). MANAGEMENT tier: the donor
// page ships verbatim (Assignment.css) and was authored against WA Mancer's
// global element base + brand tokens, so it mounts under .wa-mgmt — the second
// scope of whatsapp-base.css (same donor environment as the inbox's .wa-root,
// same hex values as IGF's ant.* palette). whatsapp.css = base tokens/element
// rules + app.css (.page/.page-hero chrome). Rides IGF's supabase client, auth
// session and router; WaShell provides the WA-scoped QueryClient (tuned
// defaults + mutation-error toasts) and Toaster.
import './styles/whatsapp.css'
import AdminAssignment from './routes/admin/Assignment'
import WaShell from './WaShell'
import { AdminWaRealtime } from './lib/queries/waChannels'

export default function WhatsappAssignment() {
  return (
    <WaShell>
      <AdminWaRealtime />
      <div className="wa-mgmt ant-surface min-h-screen">
        <div className="px-4 md:px-8 py-6 md:py-8">
          <AdminAssignment />
        </div>
      </div>
    </WaShell>
  )
}
