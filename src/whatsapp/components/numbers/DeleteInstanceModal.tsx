// Multi-step "delete instance" modal. Logic 1:1 from WA Mancer; presentation
// re-skinned to the IGF design system (ant-* tokens, no WA CSS).
//
//   PREVIEW  → loads preflight RPC and shows counts of every entity that
//              will be wiped (DB rows + R2 objects). Contacts are per-
//              instance: they wipe with the instance. Re-seed the phone
//              book at the next pair via the seed step.
//   CONFIRM  → admin must type "supprimer" verbatim to unlock the destructive
//              button. Cannot be bypassed.
//   WIPING   → spinner with the sequence we're running. The edge function
//              runs R2 → Evolution → DB synchronously and returns a single
//              summary; we await it fully before showing the success card
//              and navigating away. The modal CANNOT be dismissed while
//              the mutation is in flight (Esc and scrim click are blocked).
//   DONE     → green check with the actual numbers cleared. Auto-closes
//              + navigates after 1.6 s; admin can also click "Continuer"
//              to leave immediately.

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useDeleteInstance, useInstanceDeletePreflight } from '../../lib/queries/instances'
import { normalizeError } from '../../lib/toast/store'
import type { InstanceDeleteSummary } from '../../lib/instancesApi'

type Phase = 'preview' | 'confirm' | 'wiping' | 'done' | 'error'

const REQUIRED_PHRASE = 'supprimer'

interface RowSpec {
  key: string
  label: string
  warn?: boolean
  note?: string
}

// Order + labels for the counts display. Preserve order so the modal looks
// stable between renders. Keys must match the JSON keys from the RPC.
const ROWS: RowSpec[] = [
  { key: 'conversations',            label: 'Conversations' },
  { key: 'messages',                 label: 'Messages' },
  { key: 'r2_media_objects',         label: 'Objets média R2', warn: true, note: 'images, vidéos, notes vocales, fichiers' },
  { key: 'conversation_assignments', label: 'Affectations d\'agents' },
  { key: 'conversation_notes',       label: 'Notes de conversation' },
  { key: 'conversation_tags',        label: 'Étiquettes de conversation' },
  { key: 'outbound_queue',           label: 'Lignes de file sortante' },
  { key: 'contacts',                 label: 'Contacts', warn: true, note: 'les entrées du répertoire sont propres au numéro — à réimporter au prochain appairage' },
  { key: 'jid_mapping',              label: 'Correspondances JID (LID ↔ téléphone)', note: 'propres au compte WA, non partageables' },
  { key: 'contact_profiles',         label: 'Cache de profils de contacts' },
  { key: 'media_fetch_jobs',         label: 'Tâches de récupération de médias' },
  { key: 'group_participants',       label: 'Participants de groupe' },
  { key: 'tags',                     label: 'Définitions d\'étiquettes' },
  { key: 'quick_replies',            label: 'Réponses rapides' },
  { key: 'number_pacing_state',      label: 'État de cadence' },
]

export default function DeleteInstanceModal({
  instanceId, instanceName, onCancel, onDone,
}: {
  instanceId: string
  instanceName: string
  onCancel: () => void
  onDone: () => void
}) {
  const [phase, setPhase] = useState<Phase>('preview')
  const [typed, setTyped] = useState('')
  const [summary, setSummary] = useState<InstanceDeleteSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const typedOk = typed.trim().toLowerCase() === REQUIRED_PHRASE

  // Only fetch the preview while we're actually previewing/confirming — never
  // after the delete fires (a refetch would hit a deleted instance → error).
  const preflight = useInstanceDeletePreflight(instanceId, phase === 'preview' || phase === 'confirm')
  const del = useDeleteInstance()

  // Block Esc + scrim while wiping
  const wiping = phase === 'wiping'
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !wiping) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel, wiping])

  // After success, auto-navigate after a brief celebratory window
  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(onDone, 1600)
    return () => clearTimeout(t)
  }, [phase, onDone])

  async function execute() {
    setPhase('wiping')
    setError(null)
    try {
      const r = await del.mutateAsync(instanceId)
      setSummary(r.summary)
      setPhase('done')
    } catch (e) {
      const msg = normalizeError(e)
      // Idempotent-delete UX: a rich instance (tens of thousands of rows +
      // R2 sweep + Evolution logout) can outlive the client deadline — the
      // server keeps wiping. A retry (or the timed-out call itself) coming
      // back not_found means the wipe ALREADY SUCCEEDED: render success,
      // not "Élément introuvable".
      if (/instance_not_found|not_found|introuvable/i.test(msg)) {
        setSummary(null)
        setPhase('done')
        return
      }
      setError(msg)
      setPhase('error')
    }
  }

  return (
    <motion.div
      className="ant-surface fixed inset-0 z-50 flex items-center justify-center bg-ant-ink/40 backdrop-blur-sm p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={(e) => { if (e.target === e.currentTarget && !wiping) onCancel() }}
    >
      <motion.div
        className="w-full max-w-lg max-h-[86vh] overflow-y-auto rounded-2xl border border-ant-line bg-ant-paper shadow-2xl"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delmodal-title"
      >
        <AnimatePresence mode="wait" initial={false}>
          {phase === 'preview' && (
            <Preview
              key="preview"
              instanceName={instanceName}
              preflight={preflight.data}
              loading={preflight.isLoading}
              error={preflight.error as Error | null}
              onCancel={onCancel}
              onContinue={() => setPhase('confirm')}
            />
          )}
          {phase === 'confirm' && (
            <Confirm
              key="confirm"
              instanceName={instanceName}
              typed={typed}
              typedOk={typedOk}
              onChange={setTyped}
              onBack={() => { setTyped(''); setPhase('preview') }}
              onExecute={execute}
            />
          )}
          {phase === 'wiping' && <Wiping key="wiping" instanceName={instanceName} />}
          {phase === 'done' && <Done key="done" summary={summary} onClose={onDone} />}
          {phase === 'error' && (
            <ErrorView
              key="error"
              message={error ?? 'Échec inconnu'}
              onBack={() => setPhase('confirm')}
              onCancel={onCancel}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

/* ─── Shared IGF button styles ────────────────────────────────────────── */

const btnGhost = 'inline-flex items-center justify-center h-10 px-5 rounded-full text-[12px] font-semibold border border-ant-line bg-transparent text-ant-ink hover:bg-ant-ink/5 cursor-pointer transition-colors'
const btnDanger = 'inline-flex items-center justify-center h-10 px-5 rounded-full text-[12px] font-semibold bg-ant-rose text-white hover:bg-ant-rose/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors'

/* ─── Phase 1: preview ────────────────────────────────────────────────── */

function Preview({
  instanceName, preflight, loading, error, onCancel, onContinue,
}: {
  instanceName: string
  preflight: { counts: Record<string, number>; r2_keys: string[] } | null | undefined
  loading: boolean
  error: Error | null
  onCancel: () => void
  onContinue: () => void
}) {
  const counts = preflight?.counts ?? {}
  let total = 0
  for (const v of Object.values(counts)) total += v ?? 0

  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2 }}
      className="p-6"
    >
      <header className="space-y-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-rose">
          <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
          Zone de danger
        </span>
        <h2 id="delmodal-title" className="font-display text-[20px] tracking-tight text-ant-ink">
          Supprimer <span className="text-ant-rose">{instanceName}</span> ?
        </h2>
        <p className="font-serif italic text-[13px] leading-relaxed text-ant-mid">
          Cette action va <strong className="text-ant-ink not-italic">effacer définitivement</strong> chaque enregistrement ci-dessous de la base de données,
          du serveur Evolution et de Cloudflare R2. Aucun retour en arrière possible.
        </p>
      </header>

      <div className="mt-4">
        {loading && <div className="text-[13px] text-ant-mid py-6 text-center">Chargement de l'aperçu…</div>}
        {error && (/instance_not_found|not_found/i.test(error.message)
          ? <div className="text-[13px] text-ant-mid py-6 text-center">Ce numéro n'existe plus (déjà supprimé).</div>
          : <div className="text-[13px] text-ant-rose py-3">Impossible de charger l'aperçu : {error.message}</div>)}
        {!loading && preflight && (
          <ul className="rounded-xl border border-ant-line divide-y divide-ant-line overflow-hidden">
            {ROWS.map((r) => {
              const v = counts[r.key] ?? 0
              if (v === 0) return null
              return (
                <li key={r.key} className={'flex items-start gap-3 px-4 py-2.5 ' + (r.warn ? 'bg-ant-rose/5' : 'bg-ant-paper')}>
                  <span className={'mt-0.5 text-[13px] leading-none ' + (r.warn ? 'text-ant-rose' : 'text-ant-mid')} aria-hidden>×</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] text-ant-ink">{r.label}</span>
                    {r.note && <span className="block text-[11px] text-ant-mid mt-0.5">{r.note}</span>}
                  </span>
                  <span className="font-display text-[13px] font-semibold text-ant-ink tabular-nums">{v.toLocaleString()}</span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[12px] text-ant-mid">
          {loading ? '' : <strong className="text-ant-ink">{total.toLocaleString()}</strong>}
          {loading ? '' : ' enregistrements seront supprimés'}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" className={btnGhost} onClick={onCancel}>Annuler</button>
          <button
            type="button"
            className={btnDanger}
            disabled={loading || !!error}
            onClick={onContinue}
          >Continuer</button>
        </div>
      </footer>
    </motion.div>
  )
}

/* ─── Phase 2: confirm (type "supprimer") ─────────────────────────────── */

function Confirm({
  instanceName, typed, typedOk, onChange, onBack, onExecute,
}: {
  instanceName: string
  typed: string
  typedOk: boolean
  onChange: (s: string) => void
  onBack: () => void
  onExecute: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])

  return (
    <motion.div
      key="confirm"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2 }}
      className="p-6"
    >
      <header className="space-y-2">
        <span className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.24em] text-ant-rose">
          <span className="h-1.5 w-1.5 rounded-full bg-ant-rose" />
          Dernière chance
        </span>
        <h2 className="font-display text-[20px] tracking-tight text-ant-ink">
          Tapez <code className="px-1.5 py-0.5 rounded-md bg-ant-rose/10 text-ant-rose font-mono text-[16px]">{REQUIRED_PHRASE}</code> pour confirmer
        </h2>
        <p className="font-serif italic text-[13px] leading-relaxed text-ant-mid">
          Vous êtes sur le point d'effacer <strong className="text-ant-ink not-italic">{instanceName}</strong> du serveur, de la base de données et de R2.
        </p>
      </header>

      <div className="mt-5 max-w-xs">
        <input
          ref={ref}
          type="text"
          className="w-full h-11 px-4 rounded-xl border border-ant-line bg-white text-[14px] font-mono text-ant-ink outline-none focus:border-ant-rose/50 focus:ring-2 focus:ring-ant-rose/15"
          value={typed}
          placeholder={REQUIRED_PHRASE}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && typedOk) onExecute() }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`Tapez ${REQUIRED_PHRASE} pour confirmer`}
        />
      </div>

      <footer className="mt-5 flex items-center justify-between gap-3">
        <span className="text-[12px] text-ant-mid">{typedOk ? <strong className="text-ant-green">Prêt</strong> : 'La phrase doit correspondre exactement'}</span>
        <div className="flex items-center gap-2">
          <button type="button" className={btnGhost} onClick={onBack}>Retour</button>
          <button
            type="button"
            className={btnDanger}
            disabled={!typedOk}
            onClick={onExecute}
          >Supprimer définitivement</button>
        </div>
      </footer>
    </motion.div>
  )
}

/* ─── Phase 3: wiping (locked, no dismiss) ────────────────────────────── */

function Wiping({ instanceName }: { instanceName: string }) {
  return (
    <motion.div
      key="wiping"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.2 }}
      className="p-8 flex flex-col items-center text-center"
    >
      <div aria-hidden>
        <svg width="48" height="48" viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" fill="none" stroke="#e8e6dc" strokeWidth="4" />
          <circle cx="25" cy="25" r="20" fill="none" stroke="#c96356" strokeWidth="4"
                  strokeDasharray="60 80" strokeLinecap="round" transform="rotate(-90 25 25)">
            <animateTransform attributeName="transform" type="rotate" from="-90 25 25" to="270 25 25" dur="1s" repeatCount="indefinite" />
          </circle>
        </svg>
      </div>
      <h3 className="font-display text-[18px] tracking-tight text-ant-ink mt-4">Effacement de {instanceName}…</h3>
      <ul className="mt-4 space-y-1.5 text-left">
        <li className="text-[13px] text-ant-ink flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-ant-rose animate-pulse" />Nettoyage du bucket média R2</li>
        <li className="text-[13px] text-ant-ink flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-ant-rose animate-pulse" />Déconnexion du serveur Evolution</li>
        <li className="text-[13px] text-ant-ink flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-ant-rose animate-pulse" />Suppression des enregistrements de la base</li>
      </ul>
      <p className="font-serif italic text-[12px] text-ant-mid mt-4">Ne fermez pas cet onglet. Cela prend généralement quelques secondes.</p>
    </motion.div>
  )
}

/* ─── Phase 4: done ──────────────────────────────────────────────────── */

function Done({ summary, onClose }: { summary: InstanceDeleteSummary | null; onClose: () => void }) {
  const c = summary?.counts ?? {}
  let totalDb = 0
  for (const v of Object.values(c)) totalDb += v ?? 0
  return (
    <motion.div
      key="done"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
      className="p-8 flex flex-col items-center text-center"
    >
      <div aria-hidden>
        <svg width="56" height="56" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="26" fill="none" stroke="#788c5d" strokeWidth="3" />
          <path d="M16 29 L25 38 L42 19" fill="none" stroke="#788c5d" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="font-display text-[18px] tracking-tight text-ant-ink mt-4">Numéro supprimé</h3>
      <p className="font-serif italic text-[13px] text-ant-mid mt-2">
        <strong className="text-ant-ink not-italic">{totalDb.toLocaleString()}</strong> enregistrements effacés,
        {' '}<strong className="text-ant-ink not-italic">{(summary?.r2_objects_deleted ?? 0).toLocaleString()}</strong> objets R2,
        Evolution : <strong className="text-ant-ink not-italic">{summary?.evolution_status ?? 'inconnu'}</strong>.
      </p>
      <button type="button" className={btnGhost + ' mt-5'} onClick={onClose}>Continuer</button>
    </motion.div>
  )
}

/* ─── Phase 5: error (recoverable — retry or cancel) ─────────────────── */

function ErrorView({ message, onBack, onCancel }: { message: string; onBack: () => void; onCancel: () => void }) {
  return (
    <motion.div
      key="error"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      className="p-8 flex flex-col items-center text-center"
    >
      <h3 className="font-display text-[18px] tracking-tight text-ant-ink">Échec de la suppression</h3>
      <p className="text-[13px] text-ant-rose mt-2">{message}</p>
      <div className="flex items-center gap-2 mt-5">
        <button type="button" className={btnGhost} onClick={onCancel}>Fermer</button>
        <button type="button" className={btnDanger} onClick={onBack}>Réessayer</button>
      </div>
    </motion.div>
  )
}
