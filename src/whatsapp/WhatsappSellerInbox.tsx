// Mount for the SELLER (agent) WhatsApp inbox (page 3 — WA-VERBATIM tier).
//
// Donor: /user/whatsapp — a pixel-replica of the admin inbox whose
// restrictions live in the route wrapper (RLS-scoped conversations,
// isAdmin={false}, switch-only connection gate). Same CSS ORDER CONTRACT as
// WhatsappConversations: whatsapp.css (scoped base) BEFORE the page module,
// wa-responsive.css after.
//
// ActiveInstanceProvider: the donor mounted it in its UserLayout navbar so the
// navbar and inbox shared the active-number state. IGF sellers keep the IGF
// SellerLayout (no WA navbar), so the provider wraps just this mount — the
// in-list instance switcher (availableInstances pills) is the switching UI.
//
// SellerLayout's <main> has NO padding (pages self-pad), so this wrapper
// carries the admin AppLayout's p-4/md:p-6 itself — the height math
// (100dvh − padding) stays identical to the admin mount.
import './styles/whatsapp.css'
import './styles/wa-responsive.css'
import WaShell from './WaShell'
import { ActiveInstanceProvider } from './lib/userInbox/activeInstance'
import UserWhatsapp from './routes/user/Whatsapp'

export default function WhatsappSellerInbox() {
  return (
    <WaShell>
      <ActiveInstanceProvider>
        <div className="p-4 md:p-6">
          <div
            className="wa-root h-[calc(100dvh-2rem)] md:h-[calc(100dvh-3rem)] overflow-hidden"
            style={{
              overscrollBehavior: 'none',
              containerType: 'inline-size',
              containerName: 'waroot',
            }}
          >
            <UserWhatsapp />
          </div>
        </div>
      </ActiveInstanceProvider>
    </WaShell>
  )
}
