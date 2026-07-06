// Admin WhatsApp — Numbers page mount (page 1a). MANAGEMENT page => IGF-themed
// (ant-surface / Tailwind / shadcn), NOT the WA .wa-root look (that is reserved
// for the inbox). AdminNumbers itself carries the ant-surface root. Rides IGF's
// supabase client, auth session, router, and QueryClientProvider (App.tsx).
import AdminNumbers from './routes/numbers/Numbers'

export default function WhatsappNumbers() {
  return <AdminNumbers />
}
