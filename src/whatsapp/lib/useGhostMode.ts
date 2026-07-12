import { useCallback, useEffect, useRef, useState } from 'react'

// ─── Ghost mode (admin-only invisible viewing) ─────────────────────────────
// While ON, opening/viewing a conversation fires NEITHER mark_conversation_read
// (the unread badge stays frozen) NOR send_read_receipt (no blue-tick "seen"
// ever reaches the customer). It is the ABSENCE of two client-side RPC calls —
// there is no server/DB footprint, nothing to deploy, and it cannot leak a
// half-state: the customer's WhatsApp simply never hears from us on open.
//
// Persisted to localStorage so a reload or a navigation away-and-back never
// silently disarms it (an admin who armed ghost stays invisible until they
// explicitly flip it off). Admin-scoped by mount point: only the admin route
// wires this hook, so agents never get a toggle and their read-receipt path is
// untouched.
const KEY = 'wam.ghostMode'

function readInitial(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/**
 * Returns `[ghost, toggle, ghostRef]`.
 * - `ghost`     — reactive boolean for rendering + effect deps.
 * - `toggle`    — flip on/off (persists).
 * - `ghostRef`  — always-current value, for reading inside deferred closures
 *                 (e.g. a debounced setTimeout body) without re-scheduling.
 */
export function useGhostMode(): [boolean, () => void, React.MutableRefObject<boolean>] {
  const [ghost, setGhost] = useState<boolean>(readInitial)
  const ghostRef = useRef(ghost)
  ghostRef.current = ghost

  useEffect(() => {
    try { localStorage.setItem(KEY, ghost ? '1' : '0') } catch { /* private mode / disabled storage */ }
  }, [ghost])

  const toggle = useCallback(() => setGhost((v) => !v), [])
  return [ghost, toggle, ghostRef]
}
