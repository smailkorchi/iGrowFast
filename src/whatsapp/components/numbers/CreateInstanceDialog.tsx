import { useEffect, useRef, useState } from 'react'
import { useCreateInstance } from '../../lib/queries/instances'
import { normalizeError } from '../../lib/toast/store'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}

export function CreateInstanceDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const create = useCreateInstance()

  // IMPORTANT: do NOT include `create` in deps. The mutation object's identity
  // changes every render; including it would re-run this effect on every
  // keystroke and call setName('') after each key press — making the field
  // unusable. Only re-run when `open` flips.
  useEffect(() => {
    if (open) {
      setName('')
      setTouched(false)
      create.reset()
      // Auto-focus the input
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const trimmed = name.trim()
  const error = touched && (trimmed.length < 1 ? 'Requis'
                          : trimmed.length > 80 ? 'Trop long (80 max)' : null)
  const canSubmit = trimmed.length >= 1 && trimmed.length <= 80 && !create.isPending

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    try {
      const res = await create.mutateAsync(trimmed)
      onCreated(res.instance.id)
    } catch { /* error surfaced via mutation state */ }
  }

  return (
    <div
      className="instance-modal__backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="instance-modal" role="dialog" aria-modal="true" aria-labelledby="ci-title">
        <div className="instance-modal__beam" aria-hidden="true" />
        <header className="instance-modal__head">
          <div>
            <span className="instance-modal__eyebrow">Nouvelle connexion</span>
            <h2 id="ci-title" className="instance-modal__title">Ajouter un numéro WhatsApp</h2>
          </div>
          <button type="button" className="instance-modal__close" onClick={onClose} aria-label="Fermer">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1.5 1.5l11 11M12.5 1.5l-11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </header>

        <form onSubmit={submit} className="instance-modal__body">
          <label className="instance-modal__label" htmlFor="ci-name">
            Nom affiché
            <span className="instance-modal__hint">Comment les agents verront ce numéro dans la boîte de réception.</span>
          </label>
          <input
            ref={inputRef}
            id="ci-name"
            type="text"
            className="form__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="ex. Service client · Principal"
            disabled={create.isPending}
            maxLength={80}
            autoComplete="off"
          />
          {error && <p className="instance-modal__error">{error}</p>}
          {create.error && (
            <p className="instance-modal__error">
              Impossible de créer le numéro : {normalizeError(create.error)}
            </p>
          )}

          <div className="instance-modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={create.isPending}>
              Annuler
            </button>
            <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
              {create.isPending ? 'Création…' : 'Créer et appairer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
