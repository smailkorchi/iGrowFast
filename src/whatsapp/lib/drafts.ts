// Per-conversation composer drafts. Mirrors src/whatsapp/lib/toast/store.ts
// (module-level state + Set<listener>, dependency-free). The in-memory Map is
// the source of truth; localStorage (wam.draft.<convId>) persists across
// reloads via a ~300ms debounced write-through. A draft is cleared on send
// and whenever the composer is emptied.
import { useSyncExternalStore } from 'react'

const LS_PREFIX = 'wam.draft.'
const WRITE_DEBOUNCE_MS = 300

const drafts = new Map<string, string>()
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
const timers = new Map<string, ReturnType<typeof setTimeout>>()

// Hydrate once at module load (guarded: private mode / quota).
try {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(LS_PREFIX)) continue
    const text = localStorage.getItem(key)
    if (text) drafts.set(key.slice(LS_PREFIX.length), text)
  }
} catch { /* localStorage unavailable — drafts stay session-only */ }

// Debounced per-conversation localStorage write (the Map + emit stay sync).
function persist(conversationId: string): void {
  const pending = timers.get(conversationId)
  if (pending) clearTimeout(pending)
  timers.set(conversationId, setTimeout(() => {
    timers.delete(conversationId)
    try {
      const text = drafts.get(conversationId)
      if (text) localStorage.setItem(LS_PREFIX + conversationId, text)
      else localStorage.removeItem(LS_PREFIX + conversationId)
    } catch { /* best-effort */ }
  }, WRITE_DEBOUNCE_MS))
}

/** Draft restored into the composer when a conversation is opened. */
export function getDraft(conversationId: string): string {
  return drafts.get(conversationId) ?? ''
}

/** Write-through on composer change; whitespace-only text clears the draft. */
export function setDraft(conversationId: string, text: string): void {
  const next = text.trim() ? text : ''
  if (next === (drafts.get(conversationId) ?? '')) return
  if (next) drafts.set(conversationId, next)
  else drafts.delete(conversationId)
  persist(conversationId)
  emit()
}

/** Called after a successful hand-off to send (the composer was consumed). */
export function clearDraft(conversationId: string): void {
  setDraft(conversationId, '')
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Draft text of one conversation ('' when none); re-renders only on change. */
export function useDraft(conversationId: string | null | undefined): string {
  return useSyncExternalStore(subscribe, () => (conversationId ? drafts.get(conversationId) ?? '' : ''))
}
