// Mount for the WhatsApp inbox (page 2 — WA-VERBATIM tier).
//
// Unlike the re-skinned management pages (Numbers/NumberDetail), the inbox
// keeps WA Mancer's own look: the .wa-root wrapper activates the scoped WA
// design tokens (whatsapp.css -> whatsapp-base.css + app.css) that
// conversations.css consumes. Do NOT re-theme anything under this mount.
import WaShell from './WaShell'
import Conversations from './routes/admin/Conversations'
import './styles/whatsapp.css'

export default function WhatsappConversations() {
  return (
    <WaShell>
      <div className="wa-root">
        <Conversations />
      </div>
    </WaShell>
  )
}
