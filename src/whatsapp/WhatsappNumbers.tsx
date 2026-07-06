// Admin WhatsApp — Numbers page mount (page 1a). Grafts the isolated WA Mancer
// inbox module into the IGF SPA: scoped .wa-root wrapper + the module's own
// Toaster, rendering AdminNumbers verbatim. Rides IGF's supabase client, auth
// session, router, and QueryClientProvider (all ancestors in App.tsx).
import './styles/whatsapp.css'
import Toaster from './lib/toast/Toaster'
import AdminNumbers from './routes/numbers/Numbers'

export default function WhatsappNumbers() {
  return (
    <div className="wa-root">
      <AdminNumbers />
      <Toaster />
    </div>
  )
}
