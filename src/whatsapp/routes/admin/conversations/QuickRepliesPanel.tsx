import { useMemo, useState } from 'react'
import { useAuth } from '../../../lib/auth'
import { toast, normalizeError } from '../../../lib/toast/store'
import {
  useQuickReplies,
  useCreateQuickReply,
  useUpdateQuickReply,
  useDeleteQuickReply,
  uploadQuickReplyMedia,
  stepsSummary,
  type QuickReply,
  type MessageStep,
} from '../../../lib/queries/quickReplies'
import {
  IconArrowBack,
  IconClose,
  IconPlus,
  IconSearch,
  IconTrash,
  IconPencil,
} from './icons'
import { FlowEditor } from './NodeSequenceBuilder'
import { useProfiles } from '../../../lib/queries/users'
import { CreatorBadge } from './CreatorBadge'

export interface QuickRepliesPanelProps {
  instanceId: string | null
  onCancel: () => void
  onSelect: (qr: QuickReply) => void
}

type Subview = 'list' | 'create' | 'edit'

export function QuickRepliesPanel({ instanceId, onCancel, onSelect }: QuickRepliesPanelProps) {
  const { data: quickReplies } = useQuickReplies(instanceId)
  // quick_replies realtime rides the unified wa:biz channel (AdminWaRealtime).
  const { session, profile } = useAuth()
  const currentUid = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'
  // Creator badges are admin-only: RLS profiles_read only resolves other users'
  // profiles for an admin (an agent would just get itself back).
  const { data: profiles } = useProfiles()
  const creatorById = useMemo(
    () => new Map((profiles ?? []).map((p) => [p.id, p])),
    [profiles],
  )

  const [subview, setSubview] = useState<Subview>('list')
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!quickReplies) return []
    const q = search.trim().toLowerCase()
    if (!q) return quickReplies
    return quickReplies.filter(
      (r) => r.name.toLowerCase().includes(q) || stepsSummary(r.steps).toLowerCase().includes(q),
    )
  }, [quickReplies, search])

  const editingQr = useMemo(
    () => (editId ? quickReplies?.find((r) => r.id === editId) ?? null : null),
    [editId, quickReplies],
  )

  if (subview === 'create') {
    return (
      <QrForm
        instanceId={instanceId}
        onBack={() => setSubview('list')}
      />
    )
  }
  if (subview === 'edit' && editingQr) {
    return (
      <QrForm
        instanceId={instanceId}
        existing={editingQr}
        onBack={() => { setSubview('list'); setEditId(null) }}
      />
    )
  }

  return (
    <div className="wac__sidebar wac__sidebar--quick-replies">
      <div className="wac__qr-header">
        <button className="wac__icon-btn" onClick={onCancel} aria-label="Retour">
          <IconArrowBack size={20} />
        </button>
        <span className="wac__qr-header-title">Réponses rapides</span>
      </div>

      <div className="wac__qr-search-wrap">
        <IconSearch size={16} />
        <input
          className="wac__qr-search"
          placeholder="Rechercher..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="wac__qr-list">
        {filtered.length === 0 && (
          <div className="wac__qr-empty">Aucune réponse rapide</div>
        )}
        {filtered.map((qr) => (
          <QrListItem
            key={qr.id}
            qr={qr}
            onSelect={() => onSelect(qr)}
            onEdit={() => { setEditId(qr.id); setSubview('edit') }}
            instanceId={instanceId!}
            canManage={isAdmin || qr.created_by === currentUid}
            creator={isAdmin && qr.created_by ? creatorById.get(qr.created_by) : undefined}
          />
        ))}
      </div>

      <button
        className="wac__qr-fab"
        onClick={() => setSubview('create')}
        aria-label="Nouvelle réponse rapide"
      >
        <IconPlus size={22} />
      </button>
    </div>
  )
}

// ─── List item ───────────────────────────────────────────────────────────────

function QrListItem({
  qr, onSelect, onEdit, instanceId, canManage, creator,
}: { qr: QuickReply; onSelect: () => void; onEdit: () => void; instanceId: string; canManage: boolean; creator?: import('./CreatorBadge').CreatorProfile }) {
  const deleteMut = useDeleteQuickReply()
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="wac__qr-item">
      <button className="wac__qr-item-body" type="button" onClick={onSelect}>
        <span className="wac__qr-item-name">/{qr.name}</span>
        <span className="wac__qr-item-preview">{stepsSummary(qr.steps) || 'Séquence vide'}</span>
        <CreatorBadge profile={creator} />
      </button>
      {canManage && (
      <div className="wac__qr-item-actions">
        <button className="wac__icon-btn" onClick={onEdit} aria-label="Modifier" title="Modifier">
          <IconPencil size={16} />
        </button>
        {confirm ? (
          <button
            className="wac__icon-btn wac__icon-btn--danger"
            onClick={() => { deleteMut.mutate({ id: qr.id, instanceId }); setConfirm(false) }}
            aria-label="Confirmer la suppression"
            title="Confirmer"
          >
            <IconTrash size={16} />
          </button>
        ) : (
          <button
            className="wac__icon-btn"
            onClick={() => setConfirm(true)}
            onBlur={() => setTimeout(() => setConfirm(false), 200)}
            aria-label="Supprimer"
            title="Supprimer"
          >
            <IconClose size={16} />
          </button>
        )}
      </div>
      )}
    </div>
  )
}

// ─── Create / Edit form ───────────────────────────────────────────────────���──

function QrForm({ instanceId, existing, onBack }: {
  instanceId: string | null
  existing?: QuickReply
  onBack: () => void
}) {
  const createMut = useCreateQuickReply()
  const updateMut = useUpdateQuickReply()

  const [name, setName] = useState(existing?.name ?? '')
  const [steps, setSteps] = useState<MessageStep[]>(() => existing?.steps ?? [])
  const [saving, setSaving] = useState(false)

  const canSave = !!instanceId && !!name.trim() && steps.length > 0 && !saving

  const handleSave = async () => {
    if (!canSave || !instanceId) return
    setSaving(true)
    try {
      if (existing) {
        await updateMut.mutateAsync({ id: existing.id, instanceId, name: name.trim(), steps })
      } else {
        await createMut.mutateAsync({ instanceId, name: name.trim(), steps })
      }
      onBack()
    } catch (err) {
      console.error('QR save failed:', err)
      toast.error(normalizeError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FlowEditor
      title={existing ? 'Modifier' : 'Nouvelle réponse rapide'}
      name={name}
      onName={setName}
      namePlaceholder="ex: salut"
      steps={steps}
      onSteps={setSteps}
      uploadMedia={(f) => uploadQuickReplyMedia(instanceId!, f)}
      onCancel={onBack}
      onSave={handleSave}
      saving={saving}
      canSave={canSave}
      saveLabel="Enregistrer"
    />
  )
}
