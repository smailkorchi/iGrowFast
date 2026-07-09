// Scheduled-messages sidebar panel. Mirrors QuickRepliesPanel structurally so
// the visual language stays identical; the only delta is the date-time picker
// and the per-conversation scope (vs per-instance for quick replies).
//
// The sending side isn't wired yet — this panel only persists drafts in the
// scheduled_messages table. A worker cron job will drain due rows later.

import { useMemo, useState } from 'react'
import { useAuth } from '../../../lib/auth'
import { toast, normalizeError } from '../../../lib/toast/store'
import {
  useScheduledMessages,
  useScheduledMessagesRealtime,
  useCreateScheduledMessage,
  useUpdateScheduledMessage,
  useDeleteScheduledMessage,
  uploadScheduledMessageMedia,
  type ScheduledMessage,
} from '../../../lib/queries/scheduledMessages'
import { stepsSummary, useQuickReplies, type MessageStep, type QuickReply } from '../../../lib/queries/quickReplies'
import { FlowEditor } from './NodeSequenceBuilder'
import { useProfiles } from '../../../lib/queries/users'
import { CreatorBadge, type CreatorProfile } from './CreatorBadge'
import {
  IconArrowBack,
  IconCalendar,
  IconClock,
  IconClose,
  IconPlus,
  IconSearch,
  IconTrash,
  IconPencil,
  IconChevronDown,
  IconChevronUp,
  IconBolt,
} from './icons'

export interface ScheduledMessagesPanelProps {
  instanceId: string | null
  conversationId: string | null
  conversationName?: string
  /** When set (from the composer '#' picker's edit action), the panel opens
   *  straight into edit mode for that scheduled message. */
  initialEditId?: string | null
  onCancel: () => void
}

type Subview = 'list' | 'create' | 'edit'

export function ScheduledMessagesPanel({
  instanceId,
  conversationId,
  conversationName,
  initialEditId,
  onCancel,
}: ScheduledMessagesPanelProps) {
  const { data: scheduled } = useScheduledMessages(conversationId)
  useScheduledMessagesRealtime(conversationId, instanceId)
  const { session, profile } = useAuth()
  const currentUid = session?.user.id ?? null
  const isAdmin = profile?.role === 'admin'
  // Admin-only creator badges (RLS profiles_read resolves other users only for admins).
  const { data: profiles } = useProfiles()
  const creatorById = useMemo(
    () => new Map((profiles ?? []).map((p) => [p.id, p])),
    [profiles],
  )

  const [subview, setSubview] = useState<Subview>(initialEditId ? 'edit' : 'list')
  const [editId, setEditId] = useState<string | null>(initialEditId ?? null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!scheduled) return []
    const q = search.trim().toLowerCase()
    if (!q) return scheduled
    return scheduled.filter(
      (r) => r.name.toLowerCase().includes(q) || stepsSummary(r.steps).toLowerCase().includes(q),
    )
  }, [scheduled, search])

  const editingSm = useMemo(
    () => (editId ? scheduled?.find((r) => r.id === editId) ?? null : null),
    [editId, scheduled],
  )

  if (subview === 'create') {
    return (
      <SmForm
        instanceId={instanceId}
        conversationId={conversationId}
        conversationName={conversationName}
        onBack={() => setSubview('list')}
      />
    )
  }
  if (subview === 'edit' && editingSm) {
    return (
      <SmForm
        instanceId={instanceId}
        conversationId={conversationId}
        conversationName={conversationName}
        existing={editingSm}
        onBack={() => { setSubview('list'); setEditId(null) }}
      />
    )
  }

  return (
    <div className="wac__sidebar wac__sidebar--quick-replies wac__sidebar--scheduled-messages">
      <div className="wac__qr-header">
        <button className="wac__icon-btn" onClick={onCancel} aria-label="Retour">
          <IconArrowBack size={20} />
        </button>
        <span className="wac__qr-header-title">Messages programmés</span>
      </div>

      {conversationName && (
        <div className="wac__sm-scope">
          <IconCalendar size={14} />
          <span>{conversationName}</span>
        </div>
      )}

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
          <div className="wac__qr-empty">
            {scheduled && scheduled.length > 0
              ? 'Aucun résultat'
              : 'Aucun message programmé'}
          </div>
        )}
        {filtered.map((sm) => (
          <SmListItem
            key={sm.id}
            sm={sm}
            // Tapping the row anywhere on the body opens the edit form —
            // there is no "load into composer" path for scheduled items
            // (the '#' picker is the read-only surface for that).
            onOpenEdit={() => { setEditId(sm.id); setSubview('edit') }}
            canManage={isAdmin || sm.created_by === currentUid}
            creator={isAdmin && sm.created_by ? creatorById.get(sm.created_by) : undefined}
          />
        ))}
      </div>

      <button
        className="wac__qr-fab"
        onClick={() => setSubview('create')}
        aria-label="Nouveau message programmé"
        disabled={!conversationId || !instanceId}
        style={(!conversationId || !instanceId) ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
      >
        <IconPlus size={22} />
      </button>
    </div>
  )
}

// ─── List item ──────────────────────────────────────────────────────────────

function SmListItem({
  sm, onOpenEdit, canManage, creator,
}: { sm: ScheduledMessage; onOpenEdit: () => void; canManage: boolean; creator?: CreatorProfile }) {
  const deleteMut = useDeleteScheduledMessage()
  const [confirm, setConfirm] = useState(false)

  const due = new Date(sm.scheduled_at)
  const isPast = due.getTime() < Date.now() && sm.status === 'pending'
  const status = sm.status

  return (
    <div className={'wac__qr-item wac__sm-item' + (isPast ? ' is-overdue' : '')}>
      <button
        className="wac__qr-item-body"
        type="button"
        onClick={canManage ? onOpenEdit : undefined}
        style={canManage ? undefined : { cursor: 'default' }}
      >
        <span className="wac__qr-item-name">#{sm.name}</span>
        <span className="wac__sm-item-when">
          <IconClock size={11} />
          <span>{formatSchedule(due)}</span>
          {status !== 'pending' && (
            <span className={'wac__sm-badge wac__sm-badge--' + status}>
              {statusLabel(status)}
            </span>
          )}
        </span>
        <span className="wac__qr-item-preview">
          {stepsSummary(sm.steps) || 'Séquence vide'}
        </span>
        <CreatorBadge profile={creator} />
      </button>
      {canManage && (
      <div className="wac__qr-item-actions">
        <button className="wac__icon-btn" onClick={onOpenEdit} aria-label="Modifier" title="Modifier">
          <IconPencil size={16} />
        </button>
        {confirm ? (
          <button
            className="wac__icon-btn wac__icon-btn--danger"
            onClick={() => { deleteMut.mutate({ id: sm.id, conversationId: sm.conversation_id }); setConfirm(false) }}
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

function statusLabel(s: ScheduledMessage['status']): string {
  switch (s) {
    case 'sent':      return 'envoyé'
    case 'cancelled': return 'annulé'
    case 'failed':    return 'échec'
    default:          return ''
  }
}

// ─── Create / Edit form ──────────────────────────────────────────────────────

function SmForm({
  instanceId, conversationId, conversationName, existing, onBack,
}: {
  instanceId: string | null
  conversationId: string | null
  conversationName?: string
  existing?: ScheduledMessage
  onBack: () => void
}) {
  const createMut = useCreateScheduledMessage()
  const updateMut = useUpdateScheduledMessage()

  // Quick replies can seed a scheduled message: we copy the node sequence with
  // fresh ids, so the scheduled item is an independent snapshot — later QR
  // edits/deletes don't touch it. Create mode only.
  const { data: quickReplies } = useQuickReplies(instanceId)
  const [qrPickerOpen, setQrPickerOpen] = useState(false)

  const [name, setName] = useState(existing?.name ?? '')
  const [steps, setSteps] = useState<MessageStep[]>(() => existing?.steps ?? [])

  // Date+time. Default: 30 min from now (rounded up to next 5-min step).
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    if (existing?.scheduled_at) return new Date(existing.scheduled_at)
    const t = new Date(Date.now() + 30 * 60 * 1000)
    t.setSeconds(0, 0)
    t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5)
    return t
  })

  const [saving, setSaving] = useState(false)

  const isFuture = scheduledAt.getTime() > Date.now() + 30_000 // 30 s buffer
  const canSave = !!instanceId && !!conversationId && !!name.trim() && steps.length > 0 && isFuture && !saving

  const applyQuickReply = (qr: QuickReply) => {
    setName((prev) => (prev.trim() ? prev : qr.name))
    // Fresh ids = independent snapshot, decoupled from the source quick reply.
    setSteps((qr.steps ?? []).map((s) => ({ ...s, id: crypto.randomUUID() })))
    setQrPickerOpen(false)
  }

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      if (existing) {
        await updateMut.mutateAsync({
          id: existing.id,
          conversationId: conversationId!,
          name: name.trim(),
          steps,
          scheduledAt: scheduledAt.toISOString(),
        })
      } else {
        await createMut.mutateAsync({
          instanceId: instanceId!,
          conversationId: conversationId!,
          name: name.trim(),
          steps,
          scheduledAt: scheduledAt.toISOString(),
        })
      }
      onBack()
    } catch (err) {
      console.error('Scheduled message save failed:', err)
      toast.error(normalizeError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FlowEditor
      title={existing ? 'Modifier le programme' : 'Nouveau message programmé'}
      name={name}
      onName={setName}
      namePlaceholder="ex: relance-client"
      steps={steps}
      onSteps={setSteps}
      uploadMedia={(f) => uploadScheduledMessageMedia(conversationId!, f)}
      onCancel={onBack}
      onSave={handleSave}
      saving={saving}
      canSave={canSave}
      saveLabel={existing ? 'Mettre à jour' : 'Programmer'}
    >
      {conversationName && (
        <div className="wac__sm-target">
          <span className="wac__sm-target-label">Pour</span>
          <span className="wac__sm-target-name">{conversationName}</span>
        </div>
      )}

      {!existing && (quickReplies?.length ?? 0) > 0 && (
        <div className="wac__sm-qr-seed">
          <button
            type="button"
            className={'wac__sm-qr-seed-btn' + (qrPickerOpen ? ' is-open' : '')}
            onClick={() => setQrPickerOpen((o) => !o)}
          >
            <IconBolt size={16} />
            <span>Depuis une réponse rapide</span>
            <IconChevronDown size={16} className={qrPickerOpen ? 'is-flipped' : ''} />
          </button>
          {qrPickerOpen && (
            <div className="wac__sm-qr-seed-menu">
              {quickReplies!.map((qr) => (
                <button
                  key={qr.id}
                  type="button"
                  className="wac__sm-qr-seed-item"
                  onClick={() => applyQuickReply(qr)}
                >
                  <span className="wac__sm-qr-seed-name">#{qr.name}</span>
                  <span className="wac__sm-qr-seed-preview">
                    {stepsSummary(qr.steps) || 'Séquence vide'}
                  </span>
                  {(qr.steps?.length ?? 0) > 0 && (
                    <span className="wac__sm-qr-seed-badge">
                      {qr.steps.length} nœud{qr.steps.length > 1 ? 's' : ''}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <DateTimePicker value={scheduledAt} onChange={setScheduledAt} />
    </FlowEditor>
  )
}

// ─── Drag-and-drop zone with carousel ────────────────────────────────────────


// ─── Date-time picker ────────────────────────────────────────────────────────
//
// Dark WhatsApp-flavored calendar + 24h time stepper. Single source of truth:
// a `Date` held by the parent. Past days/times are visually disabled; the
// "Programmer" submit button is what actually enforces "future-only" — that
// lets the user pick a same-day time freely without the picker fighting them.

function DateTimePicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState<'none' | 'date' | 'time'>('none')

  const presets: { label: string; ms: number }[] = [
    { label: 'Dans 1 h',       ms: 60 * 60 * 1000 },
    { label: 'Dans 3 h',       ms: 3 * 60 * 60 * 1000 },
    { label: 'Demain 9h',      ms: tomorrowAtMs(9) },
    { label: 'Lundi 9h',       ms: nextWeekdayAtMs(1, 9) },
  ]

  const setPreset = (ms: number, absolute = false) => {
    const t = absolute ? new Date(ms) : new Date(Date.now() + ms)
    t.setSeconds(0, 0)
    onChange(t)
  }

  const inPast = value.getTime() < Date.now()

  return (
    <div className={'wac__sm-dtp' + (inPast ? ' is-invalid' : '')}>
      <span className="wac__qr-attach-heading">Programmé pour</span>

      <div className="wac__sm-dtp-row">
        <button
          type="button"
          className={'wac__sm-dtp-pill' + (open === 'date' ? ' is-open' : '')}
          onClick={() => setOpen((p) => p === 'date' ? 'none' : 'date')}
        >
          <IconCalendar size={16} />
          <span>{formatDateLong(value)}</span>
        </button>
        <button
          type="button"
          className={'wac__sm-dtp-pill' + (open === 'time' ? ' is-open' : '')}
          onClick={() => setOpen((p) => p === 'time' ? 'none' : 'time')}
        >
          <IconClock size={16} />
          <span>{formatTime(value)}</span>
        </button>
      </div>

      <div className="wac__sm-dtp-presets">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className="wac__sm-dtp-preset"
            onClick={() => setPreset(p.ms, p.label.startsWith('Demain') || p.label.startsWith('Lundi'))}
          >
            {p.label}
          </button>
        ))}
      </div>

      {open === 'date' && (
        <CalendarPopover
          value={value}
          onChange={(d) => onChange(d)}
          onClose={() => setOpen('none')}
        />
      )}
      {open === 'time' && (
        <TimePopover
          value={value}
          onChange={(d) => onChange(d)}
          onClose={() => setOpen('none')}
        />
      )}

      {inPast && (
        <div className="wac__sm-dtp-warning">
          La date est passée. Choisissez un horaire dans le futur.
        </div>
      )}
    </div>
  )
}

function CalendarPopover({
  value, onChange, onClose,
}: { value: Date; onChange: (d: Date) => void; onClose: () => void }) {
  const [viewMonth, setViewMonth] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1))

  const today = startOfDay(new Date())
  const monthStart = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
  const monthEnd   = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0)
  // Calendar grid: Monday-first
  const startOffset = (monthStart.getDay() + 6) % 7
  const totalCells  = Math.ceil((startOffset + monthEnd.getDate()) / 7) * 7

  const days: { date: Date; outOfMonth: boolean }[] = []
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(monthStart)
    d.setDate(d.getDate() + (i - startOffset))
    days.push({ date: startOfDay(d), outOfMonth: d.getMonth() !== monthStart.getMonth() })
  }

  const pickDay = (d: Date) => {
    if (d.getTime() < today.getTime()) return
    // Preserve the current hour/minute when changing day.
    const next = new Date(d)
    next.setHours(value.getHours(), value.getMinutes(), 0, 0)
    onChange(next)
  }

  const monthLabel = viewMonth.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const canPrev = monthStart > new Date(today.getFullYear(), today.getMonth(), 1)

  return (
    <div className="wac__sm-dtp-pop" onMouseLeave={onClose}>
      <div className="wac__sm-cal-head">
        <button
          type="button"
          className="wac__icon-btn"
          aria-label="Mois précédent"
          disabled={!canPrev}
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
        >
          &lsaquo;
        </button>
        <span className="wac__sm-cal-month">{capitalize(monthLabel)}</span>
        <button
          type="button"
          className="wac__icon-btn"
          aria-label="Mois suivant"
          onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
        >
          &rsaquo;
        </button>
      </div>

      <div className="wac__sm-cal-grid wac__sm-cal-grid--wd">
        {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((w, i) => (
          <span key={i} className="wac__sm-cal-wd">{w}</span>
        ))}
      </div>

      <div className="wac__sm-cal-grid">
        {days.map(({ date, outOfMonth }, i) => {
          const isPast    = date.getTime() < today.getTime()
          const isToday   = date.getTime() === today.getTime()
          const isPicked  = sameDay(date, value)
          return (
            <button
              key={i}
              type="button"
              className={
                'wac__sm-cal-day'
                + (outOfMonth ? ' is-out' : '')
                + (isPast ? ' is-past' : '')
                + (isToday ? ' is-today' : '')
                + (isPicked ? ' is-picked' : '')
              }
              disabled={isPast}
              onClick={() => pickDay(date)}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TimePopover({
  value, onChange, onClose,
}: { value: Date; onChange: (d: Date) => void; onClose: () => void }) {
  const setHour = (h: number) => {
    const next = new Date(value)
    next.setHours(((h % 24) + 24) % 24, value.getMinutes(), 0, 0)
    onChange(next)
  }
  const setMinute = (m: number) => {
    const next = new Date(value)
    const wrapped = ((m % 60) + 60) % 60
    next.setMinutes(wrapped, 0, 0)
    onChange(next)
  }

  const h = value.getHours()
  const m = value.getMinutes()

  return (
    <div className="wac__sm-dtp-pop wac__sm-dtp-pop--time" onMouseLeave={onClose}>
      <div className="wac__sm-time-stepper">
        <button type="button" className="wac__sm-time-step" onClick={() => setHour(h + 1)} aria-label="Heure +">
          <IconChevronUp size={16} />
        </button>
        <span className="wac__sm-time-val">{pad2(h)}</span>
        <button type="button" className="wac__sm-time-step" onClick={() => setHour(h - 1)} aria-label="Heure -">
          <IconChevronDown size={16} />
        </button>
      </div>
      <span className="wac__sm-time-sep">:</span>
      <div className="wac__sm-time-stepper">
        <button type="button" className="wac__sm-time-step" onClick={() => setMinute(m + 5)} aria-label="Min +">
          <IconChevronUp size={16} />
        </button>
        <span className="wac__sm-time-val">{pad2(m)}</span>
        <button type="button" className="wac__sm-time-step" onClick={() => setMinute(m - 5)} aria-label="Min -">
          <IconChevronDown size={16} />
        </button>
      </div>
    </div>
  )
}

// ─── Date helpers ───────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0); return x
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth()
      && a.getDate() === b.getDate()
}
function pad2(n: number): string { return n < 10 ? '0' + n : String(n) }
function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

function tomorrowAtMs(hour: number): number {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}
function nextWeekdayAtMs(weekday: number, hour: number): number {
  // weekday: 1=Mon ... 7=Sun
  const d = new Date()
  const cur = d.getDay() === 0 ? 7 : d.getDay()
  let delta = (weekday - cur + 7) % 7
  if (delta === 0) delta = 7
  d.setDate(d.getDate() + delta)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
function formatTime(d: Date): string {
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}
function formatSchedule(d: Date): string {
  const now = new Date()
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay(d, now))      return `Aujourd'hui à ${formatTime(d)}`
  if (sameDay(d, tomorrow)) return `Demain à ${formatTime(d)}`
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' à ' + formatTime(d)
}
