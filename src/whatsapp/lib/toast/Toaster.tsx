// Global toast renderer. Mount once near the app root (covers admin + user + login + onboard).
// Bottom-right, dark #1A1A1A cards with a kind-colored left stripe + SVG icon. framer-motion
// slide+fade. Pause-on-hover, manual dismiss, aria-live. No emoji.
import { AnimatePresence, motion } from 'framer-motion'
import { useToasts, dismissToast, pauseToast, resumeToast, type ToastKind } from './store'
import './Toaster.css'

function Icon({ kind }: { kind: ToastKind }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'success') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M8.5 12.5l2.2 2.2 4.8-5" /></svg>
  if (kind === 'info') return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.5v.5" /></svg>
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.5v.5" /></svg>
}

export default function Toaster() {
  const toasts = useToasts()
  return (
    <div className="toaster" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={'toast toast--' + t.kind}
            role={t.kind === 'error' ? 'alert' : 'status'}
            onMouseEnter={() => pauseToast(t.id)}
            onMouseLeave={() => resumeToast(t.id)}
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="toast__icon"><Icon kind={t.kind} /></span>
            <div className="toast__body">
              {t.title && <div className="toast__title">{t.title}</div>}
              <div className="toast__msg">{t.message}</div>
            </div>
            <button type="button" className="toast__close" aria-label="Fermer" onClick={() => dismissToast(t.id)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
