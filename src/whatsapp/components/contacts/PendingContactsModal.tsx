// Pending-contacts modal. Lists every unresolved LID-only contact for the
// active instance and lets the admin manually map each one to an existing
// resolved (phone-based) contact. Mapping calls upsert_jid_mapping +
// resolve_contact_from_mapping — same path the webhook takes when it
// auto-resolves on the next inbound.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  useContacts,
  useResolveContact,
  type Contact,
} from '../../lib/queries/contacts'
import { formatPhone } from '../../lib/jid'

function displayName(c: Contact): string {
  return (
    c.book_name ||
    c.push_name ||
    (c.phone_number ? formatPhone(c.phone_number) : null) ||
    c.lid?.split('@')[0] ||
    '—'
  )
}

export interface PendingContactsModalProps {
  instanceId: string
  pending: Contact[]
  onClose: () => void
}

export default function PendingContactsModal({
  instanceId,
  pending,
  onClose,
}: PendingContactsModalProps) {
  const { data: resolved } = useContacts(instanceId)
  const resolveMut = useResolveContact()

  const [openPickerFor, setOpenPickerFor] = useState<string | null>(null)
  const [pendingError, setPendingError] = useState<{ id: string; message: string } | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="aamodal-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        className="impmodal pending-modal"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="impmodal__inner">
          <header className="impmodal__head">
            <span className="impmodal__eyebrow">Identité</span>
            <h2 className="impmodal__title">Contacts en attente</h2>
            <p className="impmodal__lede">
              Ces contacts sont arrivés en LID seul — WhatsApp n'a pas encore
              partagé leur numéro de téléphone. Ils se résolvent automatiquement
              au prochain message, ou vous pouvez les associer manuellement à un
              contact existant ci-dessous.
            </p>
          </header>

          <div className="impmodal__body pending-modal__body">
            {pending.length === 0 ? (
              <div className="impmodal__empty">Aucun contact en attente.</div>
            ) : (
              <ul className="pending-modal__list">
                {pending.map((c) => {
                  const name = displayName(c)
                  const open = openPickerFor === c.id
                  const isPending = resolveMut.isPending && resolveMut.variables?.lid === c.lid
                  const err = pendingError?.id === c.id ? pendingError.message : null
                  return (
                    <li key={c.id} className="pending-modal__row">
                      <div className="pending-modal__row-main">
                        <div className="pending-modal__row-avatar">
                          {c.profile_pic ? (
                            <img src={c.profile_pic} alt="" />
                          ) : (
                            <span className="pending-modal__row-avatar-fallback">
                              {name[0]?.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="pending-modal__row-info">
                          <span className="pending-modal__row-name">{name}</span>
                          <span className="pending-modal__row-lid">
                            LID · {c.lid?.split('@')[0] ?? '—'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={
                            'pending-modal__map-btn' + (open ? ' is-open' : '')
                          }
                          onClick={() =>
                            setOpenPickerFor(open ? null : c.id)
                          }
                          disabled={isPending}
                        >
                          {open ? 'Annuler' : 'Associer à…'}
                        </button>
                      </div>

                      {err && <div className="impmodal__error pending-modal__row-error">{err}</div>}

                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div
                            key="picker"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.18 }}
                            className="pending-modal__picker-wrap"
                          >
                            <ResolvedPicker
                              resolved={resolved ?? []}
                              busy={isPending}
                              onPick={(target) => {
                                if (!c.lid || !target.phone_jid) return
                                setPendingError(null)
                                resolveMut.mutate(
                                  {
                                    instanceId,
                                    lid: c.lid,
                                    phoneJid: target.phone_jid,
                                    pendingContactId: c.id,
                                    pushName: c.push_name,
                                    profilePic: c.profile_pic,
                                  },
                                  {
                                    onSuccess: () => setOpenPickerFor(null),
                                    onError: (e) =>
                                      setPendingError({ id: c.id, message: (e as Error).message }),
                                  },
                                )
                              }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <footer className="impmodal__foot">
            <span className="impmodal__foot-stat">
              {pending.length} en attente
            </span>
            <div className="impmodal__foot-actions">
              <button
                type="button"
                className="aamodal__btn aamodal__btn--ghost"
                onClick={onClose}
              >
                Fermer
              </button>
            </div>
          </footer>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ── Resolved-contact picker ──────────────────────────────────────────── */

function ResolvedPicker({
  resolved,
  busy,
  onPick,
}: {
  resolved: Contact[]
  busy: boolean
  onPick: (c: Contact) => void
}) {
  const [q, setQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    const pool = resolved.filter((c) => !!c.phone_jid)
    if (!q.trim()) return pool.slice(0, 50)
    const needle = q.toLowerCase()
    return pool
      .filter(
        (c) =>
          c.book_name?.toLowerCase().includes(needle) ||
          c.push_name?.toLowerCase().includes(needle) ||
          c.phone_number?.includes(needle),
      )
      .slice(0, 50)
  }, [resolved, q])

  return (
    <div className="pending-modal__picker">
      <input
        ref={inputRef}
        type="text"
        className="pending-modal__picker-search"
        placeholder="Rechercher des contacts résolus…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="pending-modal__picker-list">
        {filtered.length === 0 ? (
          <div className="pending-modal__picker-empty">Aucun contact correspondant.</div>
        ) : (
          filtered.map((c) => {
            const name = displayName(c)
            return (
              <button
                key={c.id}
                type="button"
                className="pending-modal__picker-item"
                onClick={() => onPick(c)}
                disabled={busy}
              >
                <span className="pending-modal__picker-avatar">
                  {c.profile_pic ? (
                    <img src={c.profile_pic} alt="" />
                  ) : (
                    <span className="pending-modal__picker-avatar-fallback">
                      {name[0]?.toUpperCase()}
                    </span>
                  )}
                </span>
                <span className="pending-modal__picker-info">
                  <span className="pending-modal__picker-name">{name}</span>
                  {c.phone_number && (
                    <span className="pending-modal__picker-phone">
                      {formatPhone(c.phone_number)}
                    </span>
                  )}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
