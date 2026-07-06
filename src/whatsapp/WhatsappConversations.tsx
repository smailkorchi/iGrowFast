// Mount for the WhatsApp inbox (page 2 — WA-VERBATIM tier).
//
// Unlike the re-skinned management pages (Numbers/NumberDetail), the inbox
// keeps WA Mancer's own look: the .wa-root wrapper activates the scoped WA
// design tokens (whatsapp.css -> whatsapp-base.css + app.css) that
// conversations.css consumes. Do NOT re-theme anything under this mount.
// CSS ORDER CONTRACT: the donor loaded its global base (index.css) BEFORE
// conversations.css. Import whatsapp.css (the scoped base) BEFORE the page
// module so equal-specificity collisions resolve the same way they did there.
import './styles/whatsapp.css'
// IGF responsive deltas (D1 drawer / D2 list shrink) — own sheet, loads AFTER
// the page css; selectors out-specify the donor's. See file header.
import './styles/wa-responsive.css'
import WaShell from './WaShell'
import Conversations from './routes/admin/Conversations'

export default function WhatsappConversations() {
  return (
    <WaShell>
      {/* Host-integration seam (#6): WA's shell gave the inbox a definite-height,
          non-scrolling box (`:root[data-route="conversations"] .layout__main` =
          calc(100vh - 28px) + overflow hidden). IGF's AppLayout wraps pages in
          p-4 md:p-6 with auto height, so we recreate that exact contract here:
          viewport minus the wrapper padding (2×16px / 2×24px). .wac itself is
          height:100% and brings its own rounding + overflow:hidden. */}
      <div
        className="wa-root h-[calc(100dvh-2rem)] md:h-[calc(100dvh-3rem)] overflow-hidden"
        style={{
          overscrollBehavior: 'none',
          // Size container for the wa-responsive.css @container rules — the
          // breakpoints react to the INBOX width (host sidebar included), not
          // the window.
          containerType: 'inline-size',
          containerName: 'waroot',
        }}
      >
        <Conversations />
      </div>
    </WaShell>
  )
}
