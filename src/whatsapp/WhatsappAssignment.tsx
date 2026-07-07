// Admin WhatsApp — Assignment page mount (page 5). MANAGEMENT page => donor's
// own light-theme chrome (Assignment.css brand tokens), NOT the WA .wa-root
// look (reserved for the inbox). Rides IGF's supabase client, auth session and
// router; WaShell provides the WA-scoped QueryClient (tuned defaults +
// mutation-error toasts) and Toaster.
import AdminAssignment from './routes/admin/Assignment'
import WaShell from './WaShell'

export default function WhatsappAssignment() {
  return (
    <WaShell>
      <AdminAssignment />
    </WaShell>
  )
}
