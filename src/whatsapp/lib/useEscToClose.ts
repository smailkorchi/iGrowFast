// Esc closes the open conversation → back to the empty state (WhatsApp Web
// parity). Esc is heavily overloaded in the inbox (media viewer, staging tray,
// modals, context menus, forward/delete bar, order dialogs, composer pickers),
// so this fires ONLY when none of those is on top:
//   • `active` is gated by the caller to "a conversation is open in the main
//     pane, no side pane, sidebar on the list" — so search/info panes and the
//     new-chat/quick-replies/tags panels take Esc themselves.
//   • e.defaultPrevented skips anything React already handled (composer
//     slash/hash/mention pickers, Radix dialogs — they preventDefault on Esc).
//   • a DOM probe skips the ChatPane-internal overlays that own Esc via their
//     own document listeners (they don't preventDefault): media viewer,
//     staging tray, modals, context menus, the forward/delete bar, any dialog.
// A drafted reply is cancelled by the FIRST Esc; a second Esc then closes.

import { useEffect, useRef } from 'react'

const OVERLAY_SELECTOR =
  '.wac__mv, .wac__staging, .wac__modal-overlay, .wac__ctx-menu, .wac__forward-bar, [role="dialog"]'

export function useEscToCloseConversation(opts: {
  active: boolean
  replyActive: boolean
  onCancelReply: () => void
  onClose: () => void
}): void {
  const { active } = opts
  // Keep the callbacks/flags in a ref so the listener isn't re-bound each render.
  const ref = useRef(opts)
  ref.current = opts
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector(OVERLAY_SELECTOR)) return
      const { replyActive, onCancelReply, onClose } = ref.current
      if (replyActive) { onCancelReply(); return }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
