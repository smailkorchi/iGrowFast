// Admin WhatsApp — Contacts page mount (page 4). MANAGEMENT tier: the donor
// page ships verbatim (Contacts.css + shared aamodal chrome from
// Assignment.css) and mounts under .wa-mgmt — the second scope of
// whatsapp-base.css (donor element base + brand tokens; same hex values as
// IGF's ant.* palette). Header is the IGF Numbers-pattern masthead (in-page
// adaptation). Rides IGF's supabase client, auth session and router; WaShell
// provides the WA-scoped QueryClient + Toaster.
import './styles/whatsapp.css'
import AdminContacts from './routes/admin/Contacts'
import WaShell from './WaShell'

export default function WhatsappContacts() {
  return (
    <WaShell>
      <div className="wa-mgmt ant-surface min-h-screen">
        <div className="px-4 md:px-8 py-6 md:py-8">
          <AdminContacts />
        </div>
      </div>
    </WaShell>
  )
}
