import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInstances } from '../../lib/queries/instances'
import {
  useContacts,
  useUnresolvedContacts,
  useUpsertContact,
  useDeleteContacts,
  type Contact,
} from '../../lib/queries/contacts'
import { formatPhone } from '../../lib/jid'
import type { WhatsappInstance } from '../../lib/database.types'
import ImportContactsModal from '../../components/contacts/ImportContactsModal'
import PendingContactsModal from '../../components/contacts/PendingContactsModal'
import './Contacts.css'
import '../admin/Assignment.css'

function displayName(c: Contact): string {
  return c.book_name || c.push_name || (c.phone_number ? formatPhone(c.phone_number) : null) || c.lid?.split('@')[0] || '—'
}

/* ── Instance picker (always visible) ─────────────────────────────────── */

function InstancePicker({
  instances, activeId, onPick,
}: {
  instances: WhatsappInstance[]
  activeId: string | null
  onPick: (id: string) => void
}) {
  if (instances.length === 0) {
    return <div className="contacts-picker__empty">Aucun numéro connecté — appairez-en un dans Numéros.</div>
  }
  return (
    <div className="contacts-picker" role="radiogroup" aria-label="Instance">
      {instances.map((i) => {
        const active = i.id === activeId
        return (
          <button
            key={i.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={'contacts-picker__pill' + (active ? ' is-active' : '')}
            onClick={() => onPick(i.id)}
          >
            {i.profile_pic_url
              ? <img src={i.profile_pic_url} alt="" className="contacts-picker__avatar" />
              : <span className="contacts-picker__avatar contacts-picker__avatar--fallback">
                  {(i.display_name || i.phone_number || '?').slice(0, 1).toUpperCase()}
                </span>}
            <span className="contacts-picker__name">{i.display_name || i.phone_number || 'Sans nom'}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ── Add / Edit modal ──────────────────────────────────────────────────── */

type ContactModalState = { mode: 'add' } | { mode: 'edit'; contact: Contact } | null

function ContactModal({
  state,
  instances,
  defaultInstanceId,
  onClose,
}: {
  state: NonNullable<ContactModalState>
  instances: WhatsappInstance[]
  defaultInstanceId: string
  onClose: () => void
}) {
  const isEdit = state.mode === 'edit'
  const initial = isEdit ? state.contact : null
  const [name, setName] = useState(initial?.book_name ?? '')
  const [phone, setPhone] = useState(initial?.phone_number ?? '')
  const [instanceId, setInstanceId] = useState<string>(initial?.instance_id ?? defaultInstanceId)
  const upsert = useUpsertContact()

  const activeInstance = instances.find((i) => i.id === instanceId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = phone.replace(/[^0-9+]/g, '')
    if (trimmed.length < 7) return
    upsert.mutate(
      {
        id: initial?.id,
        instanceId,
        phoneNumber: trimmed,
        bookName: name.trim() || null,
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="aamodal-scrim" onClick={onClose}>
      <form
        className="impmodal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{ maxWidth: 460 }}
      >
        <div className="impmodal__inner">
          <header className="impmodal__head">
            <span className="impmodal__eyebrow">Contacts</span>
            <h2 className="impmodal__title">{isEdit ? 'Modifier le contact' : 'Ajouter un contact'}</h2>
          </header>

          <div className="impmodal__body">
            <section className="impmodal__section">
              <span className="impmodal__section-title">Numéro cible</span>
              {isEdit ? (
                <div className="impmodal__inst-locked">
                  {activeInstance && (activeInstance.profile_pic_url
                    ? <img src={activeInstance.profile_pic_url} alt="" className="impmodal__inst-avatar" />
                    : <span className="impmodal__inst-avatar impmodal__inst-avatar--fallback">{(activeInstance.display_name ?? '?').slice(0, 1)}</span>)}
                  <span className="impmodal__inst-name">
                    {activeInstance?.display_name || activeInstance?.phone_number || '—'}
                  </span>
                  <span className="impmodal__inst-locked-tag">Déplacement impossible</span>
                </div>
              ) : instances.length <= 1 && activeInstance ? (
                <div className="impmodal__inst-locked">
                  {activeInstance.profile_pic_url
                    ? <img src={activeInstance.profile_pic_url} alt="" className="impmodal__inst-avatar" />
                    : <span className="impmodal__inst-avatar impmodal__inst-avatar--fallback">{(activeInstance.display_name ?? '?').slice(0, 1)}</span>}
                  <span className="impmodal__inst-name">
                    {activeInstance.display_name || activeInstance.phone_number}
                  </span>
                  <span className="impmodal__inst-locked-tag">Seul numéro</span>
                </div>
              ) : (
                <ul className="impmodal__inst-list">
                  {instances.map((i) => {
                    const active = i.id === instanceId
                    return (
                      <li
                        key={i.id}
                        className={'impmodal__inst-card' + (active ? ' is-active' : '')}
                        onClick={() => setInstanceId(i.id)}
                      >
                        {i.profile_pic_url
                          ? <img src={i.profile_pic_url} alt="" className="impmodal__inst-avatar" />
                          : <span className="impmodal__inst-avatar impmodal__inst-avatar--fallback">{(i.display_name ?? '?').slice(0, 1)}</span>}
                        <span className="impmodal__inst-name">{i.display_name || i.phone_number}</span>
                        {active && <span className="impmodal__inst-tick" aria-hidden>✓</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="impmodal__section">
              <span className="impmodal__section-title">Nom</span>
              <input
                className="contacts-modal__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom du contact"
                autoFocus
              />
            </section>

            <section className="impmodal__section">
              <span className="impmodal__section-title">Numéro de téléphone</span>
              <input
                className="contacts-modal__input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+212 6XX XXX XXX"
                required
              />
            </section>

            {upsert.error && <div className="impmodal__error">{(upsert.error as Error).message}</div>}
          </div>

          <footer className="impmodal__foot">
            <span className="impmodal__foot-stat">{isEdit ? 'Modification d\'un contact existant' : 'Ajoute au numéro sélectionné'}</span>
            <div className="impmodal__foot-actions">
              <button type="button" className="aamodal__btn aamodal__btn--ghost" onClick={onClose}>Annuler</button>
              <button
                type="submit"
                className="aamodal__btn aamodal__btn--cta"
                disabled={upsert.isPending || phone.replace(/[^0-9+]/g, '').length < 7}
              >
                {upsert.isPending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Ajouter'}
              </button>
            </div>
          </footer>
        </div>
      </form>
    </div>
  )
}

/* ── Delete confirmation modal ────────────────────────────────────────── */

function DeleteConfirmModal({
  count,
  onConfirm,
  onCancel,
  isPending,
}: {
  count: number
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}) {
  return (
    <div className="aamodal-scrim" onClick={onCancel}>
      <div className="impmodal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="impmodal__inner impmodal__inner--center" style={{ padding: '28px 22px 20px' }}>
          <h3 className="impmodal__title">Supprimer {count} contact{count > 1 ? 's' : ''} ?</h3>
          <p className="impmodal__lede">
            Action irréversible. {count > 1
              ? 'Les contacts seront définitivement supprimés de ce numéro.'
              : 'Le contact sera définitivement supprimé de ce numéro.'}
          </p>
          <div className="impmodal__foot-actions" style={{ marginTop: 6 }}>
            <button type="button" className="aamodal__btn aamodal__btn--ghost" onClick={onCancel}>Annuler</button>
            <button
              type="button"
              className="aamodal__btn aamodal__btn--cta"
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Suppression…' : 'Supprimer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Contact row ──────────────────────────────────────────────────────── */

function ContactRow({
  contact,
  onMessage,
  onEdit,
  onDelete,
  selected,
  onToggleSelect,
  selectMode,
}: {
  contact: Contact
  onMessage?: () => void
  onEdit: () => void
  onDelete: () => void
  selected: boolean
  onToggleSelect: () => void
  selectMode: boolean
}) {
  const name = displayName(contact)
  const secondary = contact.book_name && contact.push_name ? contact.push_name : contact.phone_number
  return (
    <div className={`contacts__row${selected ? ' contacts__row--selected' : ''}`}>
      <button
        type="button"
        className={`contacts__row-check${selectMode ? ' contacts__row-check--visible' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
        aria-label={selected ? 'Désélectionner' : 'Sélectionner'}
      >
        {selected && (
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <div className="contacts__row-avatar">
        {contact.profile_pic
          ? <img src={contact.profile_pic} alt="" />
          : <span className="contacts__row-avatar-fallback">{name[0]?.toUpperCase()}</span>
        }
      </div>
      <div className="contacts__row-info">
        <span className="contacts__row-name">{name}</span>
        {secondary && secondary !== name && (
          <span className="contacts__row-secondary">{secondary}</span>
        )}
      </div>
      <div className="contacts__row-ids">
        {contact.phone_jid && <span className="contacts__row-tag contacts__row-tag--phone">{contact.phone_number}</span>}
        {contact.lid && !contact.phone_jid && <span className="contacts__row-tag contacts__row-tag--lid">LID</span>}
      </div>
      <div className="contacts__row-actions">
        {onMessage && (
          <button type="button" className="contacts__row-msg-btn" onClick={onMessage}>
            Message
          </button>
        )}
        <button type="button" className="contacts__row-icon-btn" onClick={onEdit} title="Modifier">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
        <button type="button" className="contacts__row-icon-btn contacts__row-icon-btn--delete" onClick={onDelete} title="Supprimer">
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

/* ── Main page ────────────────────────────────────────────────────────── */

export default function AdminContacts() {
  const navigate = useNavigate()
  const { data: instances } = useInstances()
  const connected = useMemo(() => instances?.filter((i) => i.status === 'connected') ?? [], [instances])

  // Page-level active instance — always picked explicitly. Defaults to first
  // connected; admin can switch via the picker. Scopes every action below.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const activeInstance = selectedId ?? connected[0]?.id ?? null

  const { data: contacts, isLoading } = useContacts(activeInstance)
  const { data: unresolved } = useUnresolvedContacts(activeInstance)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!contacts) return []
    if (!search.trim()) return contacts
    const q = search.toLowerCase()
    return contacts.filter((c) =>
      (c.book_name?.toLowerCase().includes(q)) ||
      (c.push_name?.toLowerCase().includes(q)) ||
      (c.phone_number?.includes(q))
    )
  }, [contacts, search])

  const [modal, setModal] = useState<ContactModalState>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingOpen, setPendingOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null)
  const deleteMutation = useDeleteContacts()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectMode = selected.size > 0

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAll() { setSelected(new Set(filtered.map((c) => c.id))) }
  function clearSelection() { setSelected(new Set()) }

  function handleDeleteConfirm() {
    if (!deleteTarget || !activeInstance) return
    deleteMutation.mutate(
      { ids: deleteTarget, instanceId: activeInstance },
      {
        onSuccess: () => {
          setDeleteTarget(null)
          setSelected((prev) => {
            const next = new Set(prev)
            for (const id of deleteTarget) next.delete(id)
            return next
          })
        },
      },
    )
  }

  return (
    <section className="contacts-page page">
      {/* IGF ADAPTATION: donor .page-hero masthead swapped for the IGF header
          used by every WhatsApp management page (Numbers pattern). */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
            Admin · Identité
          </div>
          <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
            Contacts
          </h1>
          <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
            Répertoire par numéro. Choisissez le numéro, puis ajoutez ou importez des contacts.
            Les deux actions sont limitées à votre sélection.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {unresolved && unresolved.length > 0 && (
            <button
              type="button"
              className="contacts-page__pending-btn"
              onClick={() => setPendingOpen(true)}
              disabled={!activeInstance}
            >
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              En attente
              <span className="contacts-page__pending-badge">{unresolved.length}</span>
            </button>
          )}
          <button
            type="button"
            className="contacts-page__import-btn"
            onClick={() => setImportOpen(true)}
            disabled={!activeInstance}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Importer le répertoire
          </button>
          <button
            type="button"
            className="contacts-page__add-btn"
            onClick={() => setModal({ mode: 'add' })}
            disabled={!activeInstance}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Ajouter un contact
          </button>
        </div>
      </header>

      <InstancePicker
        instances={connected}
        activeId={activeInstance}
        onPick={setSelectedId}
      />

      {/* ── Bulk action bar ──────────────────────────────────────────────── */}
      {selectMode && (
        <div className="contacts-page__bulk-bar">
          <span className="contacts-page__bulk-count">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span>
          <button type="button" className="contacts-page__bulk-btn" onClick={selectAll}>
            Tout sélectionner ({filtered.length})
          </button>
          <button type="button" className="contacts-page__bulk-btn" onClick={clearSelection}>
            Effacer
          </button>
          <button
            type="button"
            className="contacts-page__bulk-btn contacts-page__bulk-btn--delete"
            onClick={() => setDeleteTarget([...selected])}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Supprimer la sélection
          </button>
        </div>
      )}

      <div className="contacts-page__toolbar">
        <input
          type="text"
          className="contacts-page__search"
          placeholder="Rechercher des contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="contacts-page__count">
          {isLoading ? '—' : `${filtered.length} résolus`}
          {unresolved?.length ? ` · ${unresolved.length} en attente` : ''}
        </span>
      </div>

      <div className="contacts-page__list">
        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="contacts__row contacts__row--skeleton" />
          ))
        ) : filtered.length === 0 ? (
          <div className="contacts-page__empty">
            {activeInstance
              ? 'Aucun contact sur ce numéro. Importez un répertoire ou ajoutez-en manuellement.'
              : 'Choisissez un numéro pour voir ses contacts.'}
          </div>
        ) : (
          filtered.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              onMessage={c.phone_jid ? () => navigate(`/whatsapp/conversations?jid=${encodeURIComponent(c.phone_jid!)}`) : undefined}
              onEdit={() => setModal({ mode: 'edit', contact: c })}
              onDelete={() => setDeleteTarget([c.id])}
              selected={selected.has(c.id)}
              onToggleSelect={() => toggleSelect(c.id)}
              selectMode={selectMode}
            />
          ))
        )}
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}
      {modal && activeInstance && (
        <ContactModal
          state={modal}
          instances={connected}
          defaultInstanceId={activeInstance}
          onClose={() => setModal(null)}
        />
      )}
      {deleteTarget && activeInstance && (
        <DeleteConfirmModal
          count={deleteTarget.length}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
          isPending={deleteMutation.isPending}
        />
      )}
      {importOpen && (
        <ImportContactsModal
          defaultInstanceId={activeInstance}
          onClose={() => setImportOpen(false)}
        />
      )}
      {pendingOpen && activeInstance && (
        <PendingContactsModal
          instanceId={activeInstance}
          pending={unresolved ?? []}
          onClose={() => setPendingOpen(false)}
        />
      )}
    </section>
  )
}
