// Ultra-minimalist toast store. Mirrors src/lib/notifications/store.ts (module-level state +
// Set<listener> + useToasts hook). Dependency-free. normalizeError() turns PostgrestError /
// edge-fn reasons / thrown Errors into a human FR message (leaf module — safe to import in
// queryClient.ts without a cycle: it imports nothing app-level).
import { useEffect, useState } from 'react'

export type ToastKind = 'error' | 'success' | 'info'
export interface Toast { id: string; kind: ToastKind; title?: string; message: string; createdAt: number; duration: number; paused: boolean }

const DUR: Record<ToastKind, number> = { error: 4500, success: 2500, info: 3500 }
const MAX_STACK = 3
const DEDUPE_MS = 1200

let toasts: Toast[] = []
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
const genId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2))

function push(kind: ToastKind, message: string, opts?: { title?: string; duration?: number }): void {
  const now = Date.now()
  const dup = toasts.find((t) => t.kind === kind && t.message === message && now - t.createdAt < DEDUPE_MS)
  if (dup) { dup.createdAt = now; emit(); return } // coalesce retry-loop / per-item failures
  const t: Toast = { id: genId(), kind, message: message || 'Une erreur est survenue.', title: opts?.title, createdAt: now, duration: opts?.duration ?? DUR[kind], paused: false }
  toasts = [t, ...toasts].slice(0, MAX_STACK)
  emit()
}
export const toast = {
  error: (message: string, opts?: { title?: string; duration?: number }) => push('error', message, opts),
  success: (message: string, opts?: { title?: string; duration?: number }) => push('success', message, opts),
  info: (message: string, opts?: { title?: string; duration?: number }) => push('info', message, opts),
}
export const dismissToast = (id: string) => { toasts = toasts.filter((t) => t.id !== id); emit() }
export const pauseToast = (id: string) => { const t = toasts.find((x) => x.id === id); if (t && !t.paused) { t.paused = true; emit() } }
export const resumeToast = (id: string) => { const t = toasts.find((x) => x.id === id); if (t && t.paused) { t.paused = false; t.createdAt = Date.now(); emit() } }

export function useToasts(): Toast[] {
  const [, bump] = useState(0)
  useEffect(() => {
    const l = () => bump((n) => n + 1)
    listeners.add(l)
    const tick = setInterval(() => {
      const now = Date.now()
      const next = toasts.filter((t) => t.paused || now - t.createdAt < t.duration)
      if (next.length !== toasts.length) { toasts = next; emit() }
    }, 400)
    return () => { listeners.delete(l); clearInterval(tick) }
  }, [])
  return toasts
}

// ── error normalization → human FR message ────────────────────────────────
const REASON_FR: Record<string, string> = {
  too_large: 'Fichier trop volumineux.',
  unsupported_mime: 'Type de fichier non supporté.',
  invalid_input: 'Données invalides.',
  forbidden: 'Action non autorisée.',
  method_not_allowed: 'Méthode non autorisée.',
  signing_failed: 'Échec de la préparation du média.',
  sign_failed: 'Échec de la préparation du média.',
  unfetchable: 'Lien inaccessible.',
  timeout: 'Délai dépassé. Réessayez.',
  not_html: 'Aperçu indisponible pour ce lien.',
  server_error: 'Erreur serveur. Réessayez.',
  not_configured: 'Fonction non configurée.',
  not_found: 'Élément introuvable.',
  upload_failed: 'Échec de l’envoi du fichier.',
  unauthorized: 'Session expirée. Reconnectez-vous.',
  rate_limited: 'Trop de requêtes. Patientez un instant.',
}
const PG_CODE_FR: Record<string, string> = {
  '42501': 'Action non autorisée.',
  '23505': 'Cet élément existe déjà.',
  '23503': 'Référence invalide.',
  '23514': 'Valeur non conforme.',
  'PGRST116': 'Élément introuvable.',
  '57014': 'Délai dépassé. Réessayez.',
}
const GENERIC = 'Une erreur est survenue. Réessayez.'

export function normalizeError(err: unknown): string {
  if (err == null) return GENERIC
  const o = (typeof err === 'object' ? err as Record<string, unknown> : null)
  // 1. MediaUploadError {name:'MediaUploadError', reason}
  if (o && o.name === 'MediaUploadError' && typeof o.reason === 'string' && REASON_FR[o.reason]) return REASON_FR[o.reason]
  // 2. explicit reason field (edge fns)
  if (o && typeof o.reason === 'string' && REASON_FR[o.reason]) return REASON_FR[o.reason]
  // 3. Postgres / PostgREST code
  if (o && typeof o.code === 'string' && PG_CODE_FR[o.code]) return PG_CODE_FR[o.code]
  const raw = (o && typeof o.message === 'string') ? o.message : (typeof err === 'string' ? err : '')
  const msg = raw.trim()
  // 4. http_4xx/5xx markers
  if (/^http_4\d\d/i.test(msg)) return 'Requête refusée.'
  if (/^http_5\d\d/i.test(msg)) return 'Erreur serveur. Réessayez.'
  // 5. strip the edge-fn wrapper then retest as a reason
  const cleaned = msg.replace(/^Edge Function returned a non-2xx status code:?\s*/i, '').trim()
  if (REASON_FR[cleaned]) return REASON_FR[cleaned]
  // 6. network / fetch failures
  if ((o && o.name === 'TypeError') || /failed to fetch|networkerror|load failed|fetch failed/i.test(msg)) return 'Connexion impossible. Vérifiez votre réseau.'
  // 7. bare snake_case RPC code thrown as Error.message
  if (REASON_FR[msg]) return REASON_FR[msg]
  // 8. short readable message verbatim
  if (cleaned && cleaned.length <= 140 && /[a-zà-ÿ]/i.test(cleaned)) return cleaned
  return GENERIC
}

// Per-kind WhatsApp/Evolution size caps (MB). Inline media ~16MB; documents up to 100MB.
export const WA_SIZE_CAPS_MB: Record<string, number> = { image: 16, video: 16, audio: 16, voice: 16, ptt: 16, sticker: 1, document: 100 }
export function mediaSizeError(kind: string, bytes: number): string | null {
  const cap = WA_SIZE_CAPS_MB[kind] ?? 16
  if (bytes > cap * 1048576) return `Fichier trop volumineux : ${(bytes / 1048576).toFixed(1)} Mo (max ${cap} Mo pour ${kind === 'document' ? 'un document' : 'ce type'}).`
  return null
}
