// Import-phone-book modal. Four phases:
//
//   PICK   → choose target instance (auto-selected if only one is connected)
//            and drop the file. Country code derived from the chosen
//            instance's wa_owner_jid / phone_number.
//   DIFF   → preview: N new, M updated, K unchanged. Admin can confirm or
//            change file/instance. No writes yet.
//   APPLY  → progress bar while the chunks fire. Modal cannot be dismissed.
//   DONE   → summary card, auto-close after 1.6 s.
//
// Reusable: the Numbers pair flow embeds this same modal when offering the
// "seed phone book" step right after a fresh pairing.
//
// Brand chrome from Assignment.css (.aamodal-scrim / .aamodal__btn) + new
// .impmodal__* classes in ImportContactsModal.css.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { normalizeError } from '../../lib/toast/store'
import { useInstances } from '../../lib/queries/instances'
import { useUploadPhoneBook } from '../../lib/queries/contacts'
import type { WhatsappInstance } from '../../lib/database.types'
import './ImportContactsModal.css'

type Phase = 'pick' | 'diff' | 'apply' | 'done' | 'error'

interface PhoneBookEntry { name: string; phone: string }

interface DiffRow {
  phone: string
  name: string
  existing_name: string | null
  status: 'new' | 'updated' | 'unchanged'
}

export interface ImportContactsModalProps {
  /** Pre-selected instance (when called from pair-flow, this is locked). */
  defaultInstanceId?: string | null
  /** Lock the instance picker (used by pair-flow). */
  lockInstance?: boolean
  /** Skip the pick step and go straight to file drop with the default instance. */
  startAt?: 'pick' | 'drop'
  onClose: () => void
  onDone?: (summary: { imported: number; instanceId: string }) => void
}

export default function ImportContactsModal({
  defaultInstanceId,
  lockInstance,
  onClose,
  onDone,
}: ImportContactsModalProps) {
  const { data: instances } = useInstances()
  const connected = useMemo(() => (instances ?? []).filter((i) => i.status === 'connected'), [instances])

  const [instanceId, setInstanceId] = useState<string | null>(defaultInstanceId ?? null)
  // Auto-select the only connected instance if no default
  if (instanceId == null && !lockInstance && connected.length === 1) {
    setInstanceId(connected[0].id)
  }

  const activeInstance: WhatsappInstance | null = useMemo(
    () => (instances ?? []).find((i) => i.id === instanceId) ?? null,
    [instances, instanceId],
  )
  const countryCode = useMemo(() => deriveCountryCode(activeInstance), [activeInstance])

  const [file, setFile] = useState<File | null>(null)
  const [entries, setEntries] = useState<PhoneBookEntry[]>([])
  const [diff, setDiff] = useState<DiffRow[] | null>(null)
  const [phase, setPhase] = useState<Phase>('pick')
  const [progress, setProgress] = useState<{ imported: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const uploadMut = useUploadPhoneBook((imported, total) => setProgress({ imported, total }))

  const wiping = phase === 'apply'
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !wiping) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, wiping])

  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(onClose, 1600)
    return () => clearTimeout(t)
  }, [phase, onClose])

  async function handleFile(f: File) {
    setError(null)
    setFile(f)
    if (!instanceId) { setError('Choisissez d’abord un numéro cible.'); return }
    const text = await f.text()
    const isVcf = f.name.toLowerCase().endsWith('.vcf')
    const parsed = isVcf ? parseVcf(text) : parseCsv(text)
    if (parsed.length === 0) { setError('Aucun contact trouvé dans le fichier.'); return }

    // Deduplicate by phone (VCF duplicates are common)
    const dedupe = new Map<string, string | null>()
    for (const e of parsed) {
      const phone = normalizePhone(e.phone, countryCode)
      if (phone.length >= 7 && !dedupe.has(phone)) dedupe.set(phone, e.name || null)
    }
    const cleaned = Array.from(dedupe, ([phone, name]) => ({ phone, name: name ?? '' }))
    setEntries(cleaned)
    await computeDiff(cleaned, instanceId)
    setPhase('diff')
  }

  async function computeDiff(rows: PhoneBookEntry[], inst: string) {
    // Fetch existing contacts for this instance once, classify locally.
    const phones = rows.map((r) => r.phone)
    const { data, error: e } = await supabase
      .from('contacts')
      .select('phone_number, book_name')
      .eq('instance_id', inst)
      .in('phone_number', phones)
    if (e) { setError(normalizeError(e)); return }
    const existing = new Map<string, string | null>()
    for (const row of data ?? []) {
      if (row.phone_number) existing.set(row.phone_number, row.book_name ?? null)
    }
    const out: DiffRow[] = rows.map((r) => {
      const ex = existing.get(r.phone)
      if (ex === undefined)         return { phone: r.phone, name: r.name, existing_name: null, status: 'new' }
      if ((ex ?? '') === r.name)    return { phone: r.phone, name: r.name, existing_name: ex, status: 'unchanged' }
      return { phone: r.phone, name: r.name, existing_name: ex, status: 'updated' }
    })
    setDiff(out)
  }

  async function execute() {
    if (!instanceId || !file) return
    setPhase('apply')
    setError(null)
    setProgress({ imported: 0, total: entries.length })
    try {
      const r = await uploadMut.mutateAsync({ instanceId, file, countryCode })
      setPhase('done')
      onDone?.({ imported: r.imported, instanceId })
    } catch (e) {
      setError(normalizeError(e))
      setPhase('error')
    }
  }

  return (
    <motion.div
      /* IGF ADAPTATION: wa-mgmt on the scrim — this modal also mounts from
         PairDialog on the Numbers page (outside any .wa-mgmt subtree), so it
         must carry the donor token environment itself. */
      className="wa-mgmt aamodal-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={(e) => { if (e.target === e.currentTarget && !wiping) onClose() }}
    >
      <motion.div
        className="impmodal"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="dialog"
        aria-modal="true"
      >
        <AnimatePresence mode="wait" initial={false}>
          {(phase === 'pick' || phase === 'diff') && (
            <motion.div
              key="pickdiff"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
              className="impmodal__inner"
            >
              <header className="impmodal__head">
                <span className="impmodal__eyebrow">Répertoire</span>
                <h2 className="impmodal__title">Importer des contacts</h2>
                <p className="impmodal__lede">
                  Importez un fichier <code>.vcf</code> ou <code>.csv</code>. Chaque numéro crée une
                  fiche contact sur le numéro sélectionné.
                </p>
              </header>

              <div className="impmodal__body">
                <section className="impmodal__section">
                  <span className="impmodal__section-title">Numéro cible</span>
                  {connected.length === 0 ? (
                    <div className="impmodal__empty">Aucun numéro connecté.</div>
                  ) : lockInstance && activeInstance ? (
                    <div className="impmodal__inst-locked">
                      <InstanceAvatar inst={activeInstance} />
                      <span className="impmodal__inst-name">
                        {activeInstance.display_name || activeInstance.phone_number}
                      </span>
                      <span className="impmodal__inst-locked-tag">Verrouillé sur ce numéro</span>
                    </div>
                  ) : (
                    <ul className="impmodal__inst-list" role="radiogroup" aria-label="Instance">
                      {connected.map((i) => {
                        const active = i.id === instanceId
                        return (
                          <li
                            key={i.id}
                            className={'impmodal__inst-card' + (active ? ' is-active' : '')}
                            onClick={() => {
                              setInstanceId(i.id)
                              if (file) void handleFile(file)
                            }}
                            role="radio"
                            aria-checked={active}
                          >
                            <InstanceAvatar inst={i} />
                            <span className="impmodal__inst-name">
                              {i.display_name || i.phone_number}
                            </span>
                            {active && <span className="impmodal__inst-tick" aria-hidden>✓</span>}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>

                <section className="impmodal__section">
                  <span className="impmodal__section-title">Fichier</span>
                  <div
                    className={'impmodal__drop' + (dragOver ? ' is-drag' : '') + (file ? ' has-file' : '')}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragOver(false)
                      const f = e.dataTransfer.files[0]
                      if (f) void handleFile(f)
                    }}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".vcf,.csv"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) void handleFile(f)
                        e.target.value = ''
                      }}
                    />
                    {file ? (
                      <>
                        <span className="impmodal__drop-name">{file.name}</span>
                        <span className="impmodal__drop-hint">{entries.length} entrées · cliquez pour remplacer</span>
                      </>
                    ) : (
                      <>
                        <span className="impmodal__drop-name">Déposez un .vcf ou .csv ici</span>
                        <span className="impmodal__drop-hint">ou cliquez pour parcourir</span>
                      </>
                    )}
                  </div>
                </section>

                {error && <div className="impmodal__error">{error}</div>}

                {phase === 'diff' && diff && (
                  <section className="impmodal__section">
                    <span className="impmodal__section-title">Aperçu</span>
                    <DiffSummary diff={diff} />
                  </section>
                )}
              </div>

              <footer className="impmodal__foot">
                <span className="impmodal__foot-stat">
                  {phase === 'diff' && diff
                    ? <>{diff.length.toLocaleString()} prêts</>
                    : 'Choisir un numéro + un fichier'}
                </span>
                <div className="impmodal__foot-actions">
                  <button type="button" className="aamodal__btn aamodal__btn--ghost" onClick={onClose}>
                    Annuler
                  </button>
                  <button
                    type="button"
                    className="aamodal__btn aamodal__btn--cta"
                    disabled={phase !== 'diff' || !diff || diff.length === 0}
                    onClick={execute}
                  >
                    Importer
                  </button>
                </div>
              </footer>
            </motion.div>
          )}

          {phase === 'apply' && (
            <motion.div
              key="apply"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              className="impmodal__inner impmodal__inner--center"
            >
              <div className="impmodal__spinner" aria-hidden>
                <svg width="48" height="48" viewBox="0 0 50 50">
                  <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(20,20,19,0.1)" strokeWidth="4" />
                  <circle cx="25" cy="25" r="20" fill="none" stroke="var(--color-accent-warm)" strokeWidth="4"
                          strokeDasharray="60 80" strokeLinecap="round" transform="rotate(-90 25 25)">
                    <animateTransform attributeName="transform" type="rotate" from="-90 25 25" to="270 25 25" dur="1s" repeatCount="indefinite" />
                  </circle>
                </svg>
              </div>
              <h3 className="impmodal__title">Importation…</h3>
              {progress && (
                <>
                  <div className="impmodal__progress">
                    <div
                      className="impmodal__progress-fill"
                      style={{ width: `${progress.total ? Math.round((progress.imported / progress.total) * 100) : 0}%` }}
                    />
                  </div>
                  <p className="impmodal__lede impmodal__lede--small">
                    {progress.imported.toLocaleString()} / {progress.total.toLocaleString()}
                  </p>
                </>
              )}
            </motion.div>
          )}

          {phase === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="impmodal__inner impmodal__inner--center"
            >
              <div className="impmodal__check" aria-hidden>
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="26" fill="none" stroke="var(--color-accent-natural)" strokeWidth="3" />
                  <path d="M16 29 L25 38 L42 19" fill="none" stroke="var(--color-accent-natural)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="impmodal__title">Importé</h3>
              <p className="impmodal__lede">
                <strong>{(uploadMut.data?.imported ?? 0).toLocaleString()}</strong> contacts enregistrés
                sur <strong>{activeInstance?.display_name || activeInstance?.phone_number || 'le numéro'}</strong>.
              </p>
              <button type="button" className="aamodal__btn aamodal__btn--ghost" onClick={onClose}>Terminé</button>
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
              className="impmodal__inner impmodal__inner--center"
            >
              <h3 className="impmodal__title">Échec de l'importation</h3>
              <p className="impmodal__lede impmodal__error">{error}</p>
              <div className="impmodal__foot-actions">
                <button type="button" className="aamodal__btn aamodal__btn--ghost" onClick={onClose}>Fermer</button>
                <button type="button" className="aamodal__btn aamodal__btn--cta" onClick={() => setPhase('diff')}>Réessayer</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

/* ─── sub-components ──────────────────────────────────────────────────── */

function DiffSummary({ diff }: { diff: DiffRow[] }) {
  const n = diff.filter((d) => d.status === 'new').length
  const u = diff.filter((d) => d.status === 'updated').length
  const k = diff.filter((d) => d.status === 'unchanged').length
  return (
    <div className="impmodal__diff">
      <div className="impmodal__diff-tile impmodal__diff-tile--new">
        <span className="impmodal__diff-num">{n.toLocaleString()}</span>
        <span className="impmodal__diff-label">nouveaux</span>
      </div>
      <div className="impmodal__diff-tile impmodal__diff-tile--upd">
        <span className="impmodal__diff-num">{u.toLocaleString()}</span>
        <span className="impmodal__diff-label">mis à jour</span>
      </div>
      <div className="impmodal__diff-tile">
        <span className="impmodal__diff-num">{k.toLocaleString()}</span>
        <span className="impmodal__diff-label">inchangés</span>
      </div>
    </div>
  )
}

function InstanceAvatar({ inst }: { inst: WhatsappInstance }) {
  if (inst.profile_pic_url) {
    return <img src={inst.profile_pic_url} alt="" className="impmodal__inst-avatar" />
  }
  const seed = (inst.display_name || inst.phone_number || inst.id).slice(0, 1).toUpperCase()
  return <span className="impmodal__inst-avatar impmodal__inst-avatar--fallback">{seed}</span>
}

/* ─── parsing + normalization helpers ─────────────────────────────────── */

function parseVcf(text: string): PhoneBookEntry[] {
  const entries: PhoneBookEntry[] = []
  for (const card of text.split('BEGIN:VCARD')) {
    if (!card.trim()) continue
    const fn = card.match(/FN[^:]*:([^\r\n]+)/)
    const tel = card.match(/TEL[^:]*:([^\r\n]+)/)
    if (tel) {
      const phone = tel[1].replace(/[^0-9+]/g, '')
      const name = fn?.[1]?.trim() ?? ''
      if (phone) entries.push({ name, phone })
    }
  }
  return entries
}

function parseCsv(text: string): PhoneBookEntry[] {
  const entries: PhoneBookEntry[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return entries
  const header = lines[0].toLowerCase()
  const cols = header.split(/[,;\t]/)
  const nameIdx = cols.findIndex((c) => c.includes('name') || c.includes('nom'))
  const phoneIdx = cols.findIndex((c) => c.includes('phone') || c.includes('tel') || c.includes('number'))
  if (phoneIdx === -1) return entries
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/[,;\t]/)
    const phone = parts[phoneIdx]?.replace(/[^0-9+]/g, '') ?? ''
    const name = nameIdx >= 0 ? parts[nameIdx]?.trim() ?? '' : ''
    if (phone.length >= 7) entries.push({ name, phone })
  }
  return entries
}

function normalizePhone(raw: string, countryCode: string): string {
  let phone = raw.replace(/[^0-9]/g, '')
  if (phone.startsWith('00')) phone = phone.slice(2)
  if (phone.startsWith('0')) phone = countryCode + phone.slice(1)
  return phone
}

function deriveCountryCode(inst: WhatsappInstance | null): string {
  if (!inst) return '212'
  const candidates = [inst.phone_number, inst.wa_owner_jid?.split('@')[0]].filter(Boolean) as string[]
  for (const c of candidates) {
    const digits = c.replace(/[^0-9]/g, '')
    if (digits.length >= 8) {
      // Standard E.164 lookup — common codes only; defaults to 3-digit prefix.
      const cc1 = digits.slice(0, 1)
      const cc2 = digits.slice(0, 2)
      const cc3 = digits.slice(0, 3)
      // Single-digit: US/Canada
      if (cc1 === '1') return '1'
      // Two-digit: UK 44, FR 33, DE 49, ES 34, IT 39, BE 32, PT 351, EG 20, NG 234, SA 966, AE 971, IN 91, etc.
      if (['44','33','49','34','39','32','30','31','20','27','40','41','43','45','46','47','48','52','55','60','61','62','63','64','65','66','81','82','84','86','90','91','92','93','94','95','98'].includes(cc2)) return cc2
      // Three-digit catch-all
      return cc3
    }
  }
  return '212'
}
