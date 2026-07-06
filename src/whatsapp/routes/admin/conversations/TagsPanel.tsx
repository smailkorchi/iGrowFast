import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../lib/auth'
import {
  useTags,
  useTagsRealtime,
  useCreateTag,
  useUpdateTag,
  useDeleteTag,
  type Tag,
} from '../../../lib/queries/tags'
import { supabase } from '../../../lib/supabase'
import {
  IconArrowBack,
  IconClose,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
} from './icons'

export interface TagsPanelProps {
  instanceId: string | null
  onCancel: () => void
  // Lets the caller jump straight into the create form (e.g. when invoked
  // from the chat-header tag picker's "+" button). Defaults to the list.
  initialSubview?: 'list' | 'create'
}

const TAG_COLORS = [
  '#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0',
  '#00BCD4', '#FF5722', '#795548', '#607D8B', '#F44336',
  '#3F51B5', '#009688', '#FFC107', '#8BC34A', '#FF4081',
  '#E040FB', '#00E5FF',
]

function useRecentTagColors(instanceId: string | null) {
  const qc = useQueryClient()
  const q = useQuery<string[]>({
    queryKey: ['recent_tag_colors', instanceId],
    queryFn: async () => {
      if (!instanceId) return []
      const { data } = await supabase
        .schema('whatsapp').rpc('get_recent_tag_colors' as never, { p_instance_id: instanceId } as never)
      return (data as string[] | null) ?? []
    },
    enabled: !!instanceId,
    staleTime: 60_000,
  })

  const save = useCallback(async (color: string) => {
    if (!instanceId) return []
    const existing = q.data ?? []
    const next = [color, ...existing.filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 50)
    await supabase.schema('whatsapp').rpc('update_recent_tag_colors' as never, {
      p_instance_id: instanceId,
      p_colors: next,
    } as never)
    await qc.invalidateQueries({ queryKey: ['recent_tag_colors', instanceId] })
    return next
  }, [instanceId, q.data, qc])

  return { colors: q.data ?? [], save }
}

type Subview = 'list' | 'create' | 'edit'

export function TagsPanel({ instanceId, onCancel, initialSubview = 'list' }: TagsPanelProps) {
  const { data: tags } = useTags(instanceId)
  useTagsRealtime(instanceId)
  const { session, profile } = useAuth()
  const currentUid = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'

  const [subview, setSubview] = useState<Subview>(initialSubview)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!tags) return []
    const q = search.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, search])

  const editingTag = useMemo(
    () => (editId ? tags?.find((t) => t.id === editId) ?? null : null),
    [editId, tags],
  )

  if (subview === 'create') {
    return <TagForm instanceId={instanceId} onBack={() => setSubview('list')} />
  }
  if (subview === 'edit' && editingTag) {
    return (
      <TagForm
        instanceId={instanceId}
        existing={editingTag}
        onBack={() => { setSubview('list'); setEditId(null) }}
      />
    )
  }

  return (
    <div className="wac__sidebar wac__sidebar--tags">
      <div className="wac__qr-header">
        <button className="wac__icon-btn" onClick={onCancel} aria-label="Retour">
          <IconArrowBack size={20} />
        </button>
        <span className="wac__qr-header-title">Étiquettes</span>
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
          <div className="wac__qr-empty">Aucune étiquette</div>
        )}
        {filtered.map((tag) => (
          <TagListItem
            key={tag.id}
            tag={tag}
            onEdit={() => { setEditId(tag.id); setSubview('edit') }}
            instanceId={instanceId!}
            canManage={isAdmin || tag.created_by === currentUid}
          />
        ))}
      </div>

      <button
        className="wac__qr-fab"
        onClick={() => setSubview('create')}
        aria-label="Nouvelle étiquette"
      >
        <IconPlus size={22} />
      </button>
    </div>
  )
}

function TagListItem({ tag, onEdit, instanceId, canManage }: {
  tag: Tag; onEdit: () => void; instanceId: string; canManage: boolean
}) {
  const deleteMut = useDeleteTag()
  const [confirm, setConfirm] = useState(false)

  return (
    <div className="wac__qr-item wac__tag-item">
      <div className="wac__tag-item-body">
        <span className="wac__tag-dot" style={{ background: tag.color }} />
        <span className="wac__tag-item-name">{tag.name}</span>
      </div>
      {canManage && (
      <div className="wac__qr-item-actions">
        <button className="wac__icon-btn" onClick={onEdit} aria-label="Modifier" title="Modifier">
          <IconPencil size={16} />
        </button>
        {confirm ? (
          <button
            className="wac__icon-btn wac__icon-btn--danger"
            onClick={() => { deleteMut.mutate({ id: tag.id, instanceId }); setConfirm(false) }}
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

// ─── Tag form with custom color picker ───────────────────────────────────────

function TagForm({ instanceId, existing, onBack }: {
  instanceId: string | null
  existing?: Tag
  onBack: () => void
}) {
  const createMut = useCreateTag()
  const updateMut = useUpdateTag()

  const [name, setName] = useState(existing?.name ?? '')
  const [color, setColor] = useState(existing?.color ?? TAG_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const recents = useRecentTagColors(instanceId)

  const handleSave = async () => {
    if (!instanceId || !name.trim()) return
    setSaving(true)
    setError(null)
    try {
      if (existing) {
        await updateMut.mutateAsync({ id: existing.id, instanceId, name: name.trim(), color })
      } else {
        await createMut.mutateAsync({ instanceId, name: name.trim(), color })
      }
      onBack()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('idx_tags_instance_name') || msg.includes('duplicate')) {
        setError('Une étiquette avec ce nom existe déjà')
      } else {
        setError(msg)
      }
    } finally {
      setSaving(false)
    }
  }

  const handlePickerSelect = async (c: string) => {
    setColor(c)
    await recents.save(c)
    setPickerOpen(false)
  }

  return (
    <div className="wac__sidebar wac__sidebar--tags wac__sidebar--tag-form">
      <div className="wac__qr-header">
        <button className="wac__icon-btn" onClick={onBack} aria-label="Retour">
          <IconArrowBack size={20} />
        </button>
        <span className="wac__qr-header-title">
          {existing ? 'Modifier' : 'Nouvelle étiquette'}
        </span>
      </div>

      <div className="wac__qr-form">
        <label className="wac__qr-label">
          <span>Nom</span>
          <input
            className="wac__qr-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex: VIP"
          />
        </label>

        <div className="wac__tag-color-section">
          <span className="wac__qr-attach-heading">Couleur</span>
          <div className="wac__tag-color-grid">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={'wac__tag-color-swatch' + (color === c ? ' is-active' : '')}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={c}
              />
            ))}
            <button
              type="button"
              className={'wac__tag-color-swatch wac__tag-color-swatch--custom' + (pickerOpen ? ' is-active' : '')}
              onClick={() => setPickerOpen((v) => !v)}
              aria-label="Couleur personnalisée"
              title="Couleur personnalisée"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 000 20" fill="currentColor" opacity="0.3" />
                <circle cx="12" cy="5" r="1.5" fill="#FF5722" stroke="none" />
                <circle cx="17" cy="8" r="1.5" fill="#FFC107" stroke="none" />
                <circle cx="17" cy="16" r="1.5" fill="#4CAF50" stroke="none" />
                <circle cx="7" cy="8" r="1.5" fill="#E91E63" stroke="none" />
                <circle cx="7" cy="16" r="1.5" fill="#2196F3" stroke="none" />
                <circle cx="12" cy="19" r="1.5" fill="#9C27B0" stroke="none" />
              </svg>
            </button>
          </div>

          {pickerOpen && (
            <HslColorPicker
              value={color}
              onChange={handlePickerSelect}
            />
          )}

          {recents.colors.length > 0 && (
            <div className="wac__tag-recents">
              <span className="wac__tag-recents-heading">Couleurs récentes</span>
              <div className="wac__tag-color-grid">
                {recents.colors.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    type="button"
                    className={'wac__tag-color-swatch' + (color === c ? ' is-active' : '')}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="wac__tag-preview">
            <span className="wac__tag-dot wac__tag-dot--lg" style={{ background: color }} />
            <span className="wac__tag-preview-name">{name || 'Aperçu'}</span>
          </div>
        </div>

        {error && <div className="wac__tag-error">{error}</div>}
        <div className="wac__qr-form-actions">
          <button
            className="wac__qr-btn wac__qr-btn--cancel"
            onClick={onBack}
            disabled={saving}
          >
            Annuler
          </button>
          <button
            className="wac__qr-btn wac__qr-btn--save"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Custom HSL color picker (dark-themed, no native input) ──────────────────

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}

function HslColorPicker({ value, onChange }: {
  value: string
  onChange: (hex: string) => void
}) {
  const [hsl, setHsl] = useState(() => {
    try { return hexToHsl(value) } catch { return [0, 100, 50] as [number, number, number] }
  })
  const [h, s, l] = hsl
  const previewHex = hslToHex(h, s, l)

  const gradientRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const dragging = useRef<'gradient' | 'hue' | null>(null)

  const updateFromGradient = useCallback((clientX: number, clientY: number) => {
    const el = gradientRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))
    const newS = Math.round(x * 100)
    const newL = Math.round((1 - y) * 50 + (1 - x) * (1 - y) * 50)
    setHsl([h, newS, newL])
  }, [h])

  const updateFromHue = useCallback((clientX: number) => {
    const el = hueRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const newH = Math.round(x * 360)
    setHsl([newH, s, l])
  }, [s, l])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (dragging.current === 'gradient') updateFromGradient(e.clientX, e.clientY)
      else if (dragging.current === 'hue') updateFromHue(e.clientX)
    }
    function onUp() { dragging.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [updateFromGradient, updateFromHue])

  const thumbX = s
  const thumbY = 100 - (l / (1 - s / 200))

  return (
    <div className="wac__hsl-picker">
      <div
        className="wac__hsl-gradient"
        ref={gradientRef}
        style={{ background: `linear-gradient(to bottom, #fff, transparent, #000), linear-gradient(to right, hsl(${h},0%,50%), hsl(${h},100%,50%))` }}
        onPointerDown={(e) => { dragging.current = 'gradient'; updateFromGradient(e.clientX, e.clientY); (e.target as HTMLElement).setPointerCapture?.(e.pointerId) }}
      >
        <div
          className="wac__hsl-thumb"
          style={{
            left: `${thumbX}%`,
            top: `${Math.max(0, Math.min(100, thumbY))}%`,
            borderColor: l > 55 ? '#000' : '#fff',
          }}
        />
      </div>

      <div
        className="wac__hsl-hue"
        ref={hueRef}
        onPointerDown={(e) => { dragging.current = 'hue'; updateFromHue(e.clientX); (e.target as HTMLElement).setPointerCapture?.(e.pointerId) }}
      >
        <div
          className="wac__hsl-hue-thumb"
          style={{ left: `${(h / 360) * 100}%` }}
        />
      </div>

      <div className="wac__hsl-footer">
        <div className="wac__hsl-preview-swatch" style={{ background: previewHex }} />
        <span className="wac__hsl-hex">{previewHex.toUpperCase()}</span>
        <button
          type="button"
          className="wac__qr-btn wac__qr-btn--save wac__hsl-confirm"
          onClick={() => onChange(previewHex)}
        >
          OK
        </button>
      </div>
    </div>
  )
}
