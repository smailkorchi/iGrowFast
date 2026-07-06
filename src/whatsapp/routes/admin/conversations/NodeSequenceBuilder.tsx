// Full-screen flow editor for quick replies + scheduled messages. Left rail =
// controls (name, palette, save) + caller extras (SM date picker / QR seed);
// right = a SERPENTINE canvas: nodes flow horizontally left→right, wrap and
// continue right→left (boustrophedon), with a single animated connector path
// threading every node through the U-turns. Drag a palette node onto the canvas
// (live reflow shows the gap); drag a node to reorder. The saved order IS the
// send order.

import { Fragment, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { toast, normalizeError } from '../../../lib/toast/store'
import {
  IconArrowBack, IconClose, IconDocument, IconHeadphones, IconImage,
  IconMic, IconPencil, IconPlus, IconVideo,
} from './icons'
import {
  decodeAudioDurationSeconds,
  type MediaStep, type MediaStepType, type MessageStep, type StepType,
} from '../../../lib/queries/quickReplies'

type IconCmp = ComponentType<{ size?: number; className?: string }>
type UploadFn = (file: File) => Promise<{
  r2_key: string; r2_bucket: string; mime: string; size_bytes: number; file_name: string
}>

const DOC_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip'

// Card + grid geometry (px).
const W = 196, H = 92, GAPX = 56, GAPY = 64, PAD = 32

function IconText({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" />
    </svg>
  )
}

interface PaletteItem { type: StepType; label: string; Icon: IconCmp; accent: string }

const PALETTE: PaletteItem[] = [
  { type: 'text',       label: 'Texte',         Icon: IconText,       accent: '#53bdeb' },
  { type: 'image',      label: 'Image',         Icon: IconImage,      accent: '#06cf9c' },
  { type: 'video',      label: 'Vidéo',         Icon: IconVideo,      accent: '#f5a623' },
  { type: 'document',   label: 'Document',      Icon: IconDocument,   accent: '#7c8cff' },
  { type: 'voice',      label: 'Note vocale',   Icon: IconMic,        accent: '#ff6b9d' },
  { type: 'audio_file', label: 'Fichier audio', Icon: IconHeadphones, accent: '#ffcf5c' },
]

function metaFor(type: StepType): PaletteItem {
  return PALETTE.find((x) => x.type === type) ?? PALETTE[0]
}
function acceptFor(type: MediaStepType): string {
  switch (type) {
    case 'image':      return 'image/*'
    case 'video':      return 'video/*'
    case 'document':   return DOC_ACCEPT
    case 'voice':
    case 'audio_file': return 'audio/*'
  }
}

type TextEditor =
  | { mode: 'create'; index: number; initial: string }
  | { mode: 'edit';   id: string;    initial: string }

// ─── Layout maths (serpentine) ───────────────────────────────────────────────

interface Pt { x: number; y: number }

function computeLayout(count: number, width: number): { cols: number; pts: Pt[]; height: number } {
  const usable = Math.max(width - PAD * 2, W)
  const cols = Math.max(1, Math.floor((usable + GAPX) / (W + GAPX)))
  const pts: Pt[] = []
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols)
    const within = i % cols
    const col = row % 2 === 0 ? within : cols - 1 - within // boustrophedon
    pts.push({ x: PAD + col * (W + GAPX), y: PAD + row * (H + GAPY) })
  }
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols))
  const height = PAD * 2 + rows * H + (rows - 1) * GAPY
  return { cols, pts, height }
}

// Smooth connector threading node centres in order. Same-row segments curve
// horizontally; wrap segments (a node directly above the next) curve vertically.
function buildPath(pts: Pt[]): string {
  if (pts.length < 2) return ''
  const cx = (p: Pt) => p.x + W / 2
  const cy = (p: Pt) => p.y + H / 2
  let d = `M ${cx(pts[0])} ${cy(pts[0])}`
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const ax = cx(a), ay = cy(a), bx = cx(b), by = cy(b)
    if (Math.abs(ay - by) < 1) {
      const mx = (ax + bx) / 2
      d += ` C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}`
    } else {
      const my = (ay + by) / 2
      d += ` C ${ax} ${my}, ${bx} ${my}, ${bx} ${by}`
    }
  }
  return d
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// ─── Full-screen editor ──────────────────────────────────────────────────────

export function FlowEditor({
  title, name, onName, namePlaceholder, steps, onSteps, uploadMedia,
  onCancel, onSave, saving, canSave, saveLabel, children,
}: {
  title: string
  name: string
  onName: (v: string) => void
  namePlaceholder?: string
  steps: MessageStep[]
  onSteps: (s: MessageStep[]) => void
  uploadMedia: UploadFn
  onCancel: () => void
  onSave: () => void
  saving: boolean
  canSave: boolean
  saveLabel: string
  /** Extra rail content (SM date picker + QR seed) rendered above the palette. */
  children?: ReactNode
}) {
  const [dragType, setDragType] = useState<StepType | null>(null)

  return (
    <div className="wac__flow">
      <div className="wac__flow-rail">
        <div className="wac__flow-rail-head">
          <button className="wac__icon-btn" onClick={onCancel} aria-label="Retour"><IconArrowBack size={20} /></button>
          <span className="wac__flow-title">{title}</span>
        </div>

        <div className="wac__flow-rail-body">
          <label className="wac__qr-label">
            <span>Nom</span>
            <input
              className="wac__qr-input"
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder={namePlaceholder}
            />
          </label>

          {children}

          <div className="wac__flow-palette">
            <span className="wac__flow-palette-title">Glissez un nœud sur le canevas</span>
            <div className="wac__flow-palette-grid">
              {PALETTE.map((p) => (
                <button
                  key={p.type}
                  type="button"
                  className="wac__flow-chip"
                  draggable
                  style={{ ['--accent' as string]: p.accent }}
                  onDragStart={(e) => { setDragType(p.type); e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', p.type) }}
                  onDragEnd={() => setDragType(null)}
                  title={p.label}
                >
                  <span className="wac__flow-chip-icon"><p.Icon size={18} /></span>
                  <span className="wac__flow-chip-label">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="wac__flow-rail-foot">
          <button className="wac__qr-btn wac__qr-btn--cancel" onClick={onCancel} disabled={saving}>Annuler</button>
          <button className="wac__qr-btn wac__qr-btn--save" onClick={onSave} disabled={!canSave}>
            {saving ? 'Enregistrement...' : saveLabel}
          </button>
        </div>
      </div>

      <FlowCanvas
        steps={steps}
        onChange={onSteps}
        uploadMedia={uploadMedia}
        dragType={dragType}
        clearDragType={() => setDragType(null)}
      />
    </div>
  )
}

// ─── Canvas ──────────────────────────────────────────────────────────────────

function FlowCanvas({ steps, onChange, uploadMedia, dragType, clearDragType }: {
  steps: MessageStep[]
  onChange: (s: MessageStep[]) => void
  uploadMedia: UploadFn
  dragType: StepType | null
  clearDragType: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<{ type: MediaStepType; index: number; replaceId?: string } | null>(null)
  const [previews] = useState(() => new Map<string, string>())
  const [editor, setEditor] = useState<TextEditor | null>(null)
  const [busy, setBusy] = useState(false)
  const [insertIdx, setInsertIdx] = useState<number | null>(null)

  const width = useElementWidth(scrollRef)
  const dragging = dragType !== null
  const ghostIdx = dragging ? (insertIdx ?? steps.length) : -1
  const layoutCount = steps.length + (dragging ? 1 : 0)
  const { pts, height } = computeLayout(layoutCount, width)

  // Slot for real node i (account for the ghost gap during a palette drag).
  const slotFor = (i: number): Pt => (dragging && i >= ghostIdx ? pts[i + 1] : pts[i])
  const nodePts = steps.map((_, i) => slotFor(i))
  const connectorPts = dragging && ghostIdx >= 0 && ghostIdx <= steps.length
    // Thread the ghost into the connector so the line previews the insertion.
    ? [...nodePts.slice(0, ghostIdx), pts[ghostIdx], ...nodePts.slice(ghostIdx)]
    : nodePts
  const path = buildPath(connectorPts)

  const insertAt = (step: MessageStep, index: number) => {
    const next = steps.slice()
    next.splice(Math.max(0, Math.min(index, next.length)), 0, step)
    onChange(next)
  }
  const patchStep = (id: string, patch: Partial<MessageStep>) => {
    onChange(steps.map((s) => (s.id === id ? ({ ...s, ...patch } as MessageStep) : s)))
  }
  const removeStep = (id: string) => {
    const url = previews.get(id); if (url) { URL.revokeObjectURL(url); previews.delete(id) }
    onChange(steps.filter((s) => s.id !== id))
  }
  const moveStep = (from: number, to: number) => {
    if (from === to) return
    const a = steps.slice()
    const [item] = a.splice(from, 1)
    a.splice(Math.max(0, Math.min(to, a.length)), 0, item)
    onChange(a)
  }

  const startAdd = (type: StepType, index: number) => {
    if (type === 'text') { setEditor({ mode: 'create', index, initial: '' }); return }
    pendingRef.current = { type, index }
    // Adding media → allow BATCH selection (one node per file, in pick order).
    if (fileRef.current) { fileRef.current.accept = acceptFor(type); fileRef.current.multiple = true; fileRef.current.value = ''; fileRef.current.click() }
  }
  const startReplaceMedia = (step: MediaStep, index: number) => {
    pendingRef.current = { type: step.type, index, replaceId: step.id }
    // Replacing one node → single file only.
    if (fileRef.current) { fileRef.current.accept = acceptFor(step.type); fileRef.current.multiple = false; fileRef.current.value = ''; fileRef.current.click() }
  }

  // Build a MediaStep (upload + preview + audio duration) for one file.
  const buildMediaStep = async (file: File, id: string, type: MediaStepType): Promise<MediaStep> => {
    const up = await uploadMedia(file)
    const isAudio = type === 'voice' || type === 'audio_file'
    const seconds = isAudio ? await decodeAudioDurationSeconds(file) : undefined
    const media: MediaStep = {
      id, type,
      r2_key: up.r2_key, r2_bucket: up.r2_bucket, mime: up.mime,
      size_bytes: up.size_bytes, file_name: up.file_name,
      ...(seconds ? { seconds } : {}),
    }
    if (type === 'image' || type === 'video') {
      const old = previews.get(id); if (old) URL.revokeObjectURL(old)
      previews.set(id, URL.createObjectURL(file))
    }
    return media
  }

  const onFilesPicked = async (files: File[]) => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending || files.length === 0) return
    setBusy(true)
    try {
      if (pending.replaceId) {
        // Replace = single node, take the first file.
        const media = await buildMediaStep(files[0]!, pending.replaceId, pending.type)
        patchStep(pending.replaceId, media)
      } else {
        // Batch add = one node per file, inserted in pick order at the slot.
        const built: MediaStep[] = []
        for (const f of files) built.push(await buildMediaStep(f, crypto.randomUUID(), pending.type))
        const next = steps.slice()
        next.splice(Math.max(0, Math.min(pending.index, next.length)), 0, ...built)
        onChange(next)
      }
    } catch (err) {
      toast.error(normalizeError(err))
    } finally { setBusy(false) }
  }

  const saveEditor = (body: string) => {
    if (!editor) return
    if (!body.trim()) { setEditor(null); return }
    if (editor.mode === 'create') insertAt({ id: crypto.randomUUID(), type: 'text', body }, editor.index)
    else patchStep(editor.id, { body })
    setEditor(null)
  }

  // Point in stage coordinates from a pointer event.
  const stagePoint = (clientX: number, clientY: number): Pt => {
    const el = stageRef.current
    const r = el?.getBoundingClientRect()
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) }
  }

  // Where would a palette drop insert, given a stage point? Before/after the
  // nearest node along the serpentine flow.
  const insertIndexForPoint = (p: Pt): number => {
    if (steps.length === 0) return 0
    let best = 0, bd = Infinity
    for (let i = 0; i < steps.length; i++) {
      const c = { x: nodePts[i].x + W / 2, y: nodePts[i].y + H / 2 }
      const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2
      if (d < bd) { bd = d; best = i }
    }
    const c = { x: nodePts[best].x + W / 2, y: nodePts[best].y + H / 2 }
    const row = Math.round((nodePts[best].y - PAD) / (H + GAPY))
    const sameRowAfter = row % 2 === 0 ? p.x > c.x : p.x < c.x
    const below = p.y > c.y + H * 0.45
    return (below || sameRowAfter) ? best + 1 : best
  }

  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!dragType) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setInsertIdx(insertIndexForPoint(stagePoint(e.clientX, e.clientY)))
  }
  const onCanvasDrop = (e: React.DragEvent) => {
    if (!dragType) return
    e.preventDefault()
    const type = dragType
    const at = insertIdx ?? steps.length
    clearDragType(); setInsertIdx(null)
    startAdd(type, at)
  }

  // Nearest slot index for a dropped (reordered) node centre.
  const nearestIndex = (center: Pt): number => {
    let best = 0, bd = Infinity
    for (let i = 0; i < steps.length; i++) {
      const c = { x: nodePts[i].x + W / 2, y: nodePts[i].y + H / 2 }
      const d = (c.x - center.x) ** 2 + (c.y - center.y) ** 2
      if (d < bd) { bd = d; best = i }
    }
    return best
  }

  const empty = steps.length === 0

  return (
    <div
      ref={scrollRef}
      className={'wac__flow-canvas' + (dragging ? ' is-dragging' : '')}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setInsertIdx(null) }}
    >
      {empty && !dragging ? (
        <div className="wac__flow-empty">
          <div className="wac__flow-empty-orb"><IconPlus size={26} /></div>
          <span className="wac__flow-empty-title">Composez votre séquence</span>
          <span className="wac__flow-empty-sub">Glissez un nœud depuis le panneau de gauche. Les messages partiront dans l’ordre du fil.</span>
        </div>
      ) : (
        <div ref={stageRef} className="wac__flow-stage" style={{ height }}>
          <svg className="wac__flow-edges" width="100%" height={height} aria-hidden="true">
            {path && (
              <>
                <path className="wac__flow-edge-base" d={path} fill="none" />
                <path className="wac__flow-edge-flow" d={path} fill="none" />
              </>
            )}
            {connectorPts[0] && (
              <circle className="wac__flow-edge-cap" cx={connectorPts[0].x + W / 2} cy={connectorPts[0].y + H / 2} r={5} />
            )}
          </svg>

          {dragging && pts[ghostIdx] && (
            <div className="wac__flow-ghost" style={{ left: pts[ghostIdx].x, top: pts[ghostIdx].y, width: W, height: H }}>
              <IconPlus size={20} />
            </div>
          )}

          {steps.map((step, i) => (
            <FlowNode
              key={step.id}
              step={step}
              index={i}
              pos={nodePts[i]}
              preview={previews.get(step.id)}
              onEdit={() => {
                if (step.type === 'text') setEditor({ mode: 'edit', id: step.id, initial: step.body })
                else startReplaceMedia(step, i)
              }}
              onRemove={() => removeStep(step.id)}
              onDropAt={(center) => moveStep(i, nearestIndex(center))}
            />
          ))}
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        hidden
        multiple
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void onFilesPicked(fs); e.target.value = '' }}
      />

      {busy && <div className="wac__flow-busy"><span className="wac__nb-spinner" /></div>}

      {editor && (
        <TextEditorModal initial={editor.initial} onSave={saveEditor} onCancel={() => setEditor(null)} />
      )}
    </div>
  )
}

// ─── One node (free-drag to reorder) ─────────────────────────────────────────

function FlowNode({ step, index, pos, preview, onEdit, onRemove, onDropAt }: {
  step: MessageStep
  index: number
  pos: Pt
  preview?: string
  onEdit: () => void
  onRemove: () => void
  onDropAt: (center: Pt) => void
}) {
  const meta = metaFor(step.type)
  const summary = step.type === 'text' ? (step.body || 'Texte vide') : step.file_name

  return (
    <div className="wac__flow-slot" style={{ left: pos.x, top: pos.y, width: W, height: H }}>
      <motion.div
        className="wac__flow-node"
        style={{ ['--accent' as string]: meta.accent }}
        drag
        dragSnapToOrigin
        dragMomentum={false}
        whileDrag={{ scale: 1.05, zIndex: 60, cursor: 'grabbing' }}
        onDragEnd={(_e, info) => onDropAt({ x: pos.x + W / 2 + info.offset.x, y: pos.y + H / 2 + info.offset.y })}
      >
        <span className="wac__flow-node-index">{index + 1}</span>
        <span className="wac__flow-node-icon"><meta.Icon size={18} /></span>
        <div className="wac__flow-node-body">
          <span className="wac__flow-node-label">{meta.label}</span>
          <span className="wac__flow-node-summary">{summary}</span>
        </div>
        {preview && (
          step.type === 'video'
            ? <video className="wac__flow-node-thumb" src={preview} muted />
            : <img className="wac__flow-node-thumb" src={preview} alt="" />
        )}
        <div className="wac__flow-node-actions" onPointerDownCapture={(e) => e.stopPropagation()}>
          <button type="button" className="wac__icon-btn" aria-label="Modifier" title="Modifier" onClick={onEdit}>
            <IconPencil size={14} />
          </button>
          <button type="button" className="wac__icon-btn wac__icon-btn--danger" aria-label="Supprimer" title="Supprimer" onClick={onRemove}>
            <IconClose size={14} />
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Send-confirmation for a multi-node quick reply ──────────────────────────
// Guards against firing a whole sequence by a stray click. Shows the ordered
// node alignment + Annuler/Envoyer.

export function QuickReplyConfirm({ steps, onConfirm, onCancel }: {
  steps: MessageStep[]
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="wac__nb-modal-backdrop" onClick={onCancel}>
      <div className="wac__qrc" onClick={(e) => e.stopPropagation()}>
        <span className="wac__nb-modal-title">Envoyer cette séquence&nbsp;?</span>
        <span className="wac__qrc-sub">
          {steps.length} message{steps.length > 1 ? 's' : ''} partiront dans cet ordre, espacés automatiquement.
        </span>

        <div className="wac__qrc-track">
          {steps.map((s, i) => {
            const m = metaFor(s.type)
            const summary = s.type === 'text' ? (s.body || 'Texte vide') : s.file_name
            return (
              <Fragment key={s.id}>
                {i > 0 && <span className="wac__qrc-arrow" aria-hidden>›</span>}
                <div className="wac__qrc-node" style={{ ['--accent' as string]: m.accent }}>
                  <span className="wac__qrc-node-badge">{i + 1}</span>
                  <span className="wac__qrc-node-icon"><m.Icon size={15} /></span>
                  <span className="wac__qrc-node-label">{m.label}</span>
                  <span className="wac__qrc-node-summary">{summary}</span>
                </div>
              </Fragment>
            )
          })}
        </div>

        <div className="wac__qr-form-actions">
          <button type="button" className="wac__qr-btn wac__qr-btn--cancel" onClick={onCancel}>Annuler</button>
          <button type="button" className="wac__qr-btn wac__qr-btn--save" onClick={onConfirm}>Envoyer</button>
        </div>
      </div>
    </div>
  )
}

// ─── Text node editor modal ──────────────────────────────────────────────────

function TextEditorModal({ initial, onSave, onCancel }: {
  initial: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [val, setVal] = useState(initial)
  return (
    <div className="wac__nb-modal-backdrop" onClick={onCancel}>
      <div className="wac__nb-modal" onClick={(e) => e.stopPropagation()}>
        <span className="wac__nb-modal-title">Message texte</span>
        <textarea
          className="wac__qr-textarea wac__nb-modal-textarea"
          autoFocus
          rows={6}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Texte du message..."
        />
        <div className="wac__qr-form-actions">
          <button type="button" className="wac__qr-btn wac__qr-btn--cancel" onClick={onCancel}>Annuler</button>
          <button type="button" className="wac__qr-btn wac__qr-btn--save" onClick={() => onSave(val)} disabled={!val.trim()}>
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}
