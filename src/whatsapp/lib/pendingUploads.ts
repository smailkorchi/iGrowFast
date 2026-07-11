// Per-conversation optimistic outbound media uploads.
//
// Mirrors src/whatsapp/lib/drafts.ts (module-level Map + Set<listener> +
// useSyncExternalStore, dependency-free). Holds the CLIENT-ONLY "sending"
// state for staged media while it uploads to R2 and awaits enqueue, so the
// thread can show a WhatsApp-style progress bubble (determinate ring + cancel +
// retry) IMMEDIATELY — before the real media_pending DB row lands via realtime.
//
// Deliberately NOT stored in the React-Query thread cache: that cache is patched
// by realtime keyed on real message ids (useThreadRealtime), so synthetic rows
// would be clobbered / mis-tombstoned. A separate side store keyed by
// conversation id sidesteps all of that machinery — the render layer just reads
// pending entries for the open conversation and appends them below the thread.
//
// Lifecycle of one entry:
//   enqueue → status 'uploading' (XHR PUT, progress 0..1)
//           → status 'sending'  (upload done, paced sendMessage in flight)
//           → sentMessageId set (kept until the REAL row appears in the thread,
//                                then removePendingUpload drops it — no flicker)
//   abort / failure → status 'error' (retry re-runs upload+send from scratch)
//
// Ban-safety is unchanged: each entry still calls the normal paced sendMessage
// exactly once (no album, no blast, no bypass). Only the client transport +
// rendering differ.

import { useSyncExternalStore } from 'react'
import { uploadChatMediaWithProgress, sendMessage } from './conversationsApi'

export type PendingUploadStatus = 'uploading' | 'sending' | 'error'
export type PendingUploadKind = 'image' | 'video' | 'document' | 'audio'

export interface PendingUpload {
  /** Stable, namespaced id ('optim:<uuid>') — never collides with DB uuids. */
  clientId: string
  conversationId: string
  kind: PendingUploadKind
  name: string
  mime: string
  /** Fresh object URL for the local preview thumbnail; revoked on removal. */
  localBlobUrl: string
  /** Upload fraction 0..1 (drives the ring). */
  progress: number
  status: PendingUploadStatus
  /** ISO timestamp — entries render newest-last, below the loaded thread. */
  createdAt: string
  /** Set once sendMessage resolves; the bubble is dropped when a real message
   *  with this id appears in the thread. */
  sentMessageId: string | null
  /** True when the error state was reached by the user pressing X (not a real
   *  failure) → the bubble shows "Annulé" + retry instead of "Échec". */
  cancelled: boolean
  // ── retry payload (a failed item re-runs the whole upload+send) ──
  blob: Blob
  caption: string
  ptt: boolean
  isGif: boolean
  /** STABLE across retries — the server dedups a re-fired send on this key, so a
   *  retry after a lost-response send can never double-deliver to the customer. */
  idempotencyKey: string
}

// conversationId → ordered entries. Missing key ⇒ no pending uploads.
const byConv = new Map<string, PendingUpload[]>()
// clientId → AbortController for the in-flight R2 PUT.
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

// Stable empty reference so useSyncExternalStore doesn't loop when a
// conversation has no pending uploads.
const EMPTY: PendingUpload[] = []

// Every mutation REPLACES the conversation's array (new reference) so
// useSyncExternalStore sees a changed snapshot; the Map slot is deleted when a
// conversation drains, keeping getSnapshot === EMPTY for idle threads.
function setList(conversationId: string, list: PendingUpload[]): void {
  if (list.length) byConv.set(conversationId, list)
  else byConv.delete(conversationId)
  emit()
}

function patchEntry(conversationId: string, clientId: string, patch: Partial<PendingUpload>): void {
  const list = byConv.get(conversationId)
  if (!list) return
  const idx = list.findIndex((e) => e.clientId === clientId)
  if (idx < 0) return
  const next = list.slice()
  next[idx] = { ...next[idx]!, ...patch }
  setList(conversationId, next)
}

function findEntry(clientId: string): PendingUpload | null {
  for (const list of byConv.values()) {
    const e = list.find((x) => x.clientId === clientId)
    if (e) return e
  }
  return null
}

export interface EnqueuePendingUploadArgs {
  conversationId: string
  kind: PendingUploadKind
  name: string
  mime: string
  /** Already-resolved bytes (GIFs are fetched from their remote URL upstream). */
  blob: Blob
  caption: string
  ptt?: boolean
  isGif?: boolean
}

/** Push a new optimistic upload bubble and immediately start uploading. */
export function enqueuePendingUpload(args: EnqueuePendingUploadArgs): void {
  const clientId = 'optim:' + crypto.randomUUID()
  const entry: PendingUpload = {
    clientId,
    conversationId: args.conversationId,
    kind: args.kind,
    name: args.name,
    mime: args.mime,
    localBlobUrl: URL.createObjectURL(args.blob),
    progress: 0,
    status: 'uploading',
    createdAt: new Date().toISOString(),
    sentMessageId: null,
    cancelled: false,
    blob: args.blob,
    caption: args.caption,
    ptt: !!args.ptt,
    isGif: !!args.isGif,
    idempotencyKey: crypto.randomUUID(),
  }
  const list = byConv.get(args.conversationId) ?? []
  setList(args.conversationId, [...list, entry])
  void run(clientId)
}

// Drive one entry through upload → paced send. Abort and hard failures both
// land in the 'error' state so the bubble can offer retry.
async function run(clientId: string): Promise<void> {
  const entry = findEntry(clientId)
  if (!entry) return
  const { conversationId } = entry
  const controller = new AbortController()
  controllers.set(clientId, controller)
  patchEntry(conversationId, clientId, { status: 'uploading', progress: 0 })
  try {
    const up = await uploadChatMediaWithProgress(conversationId, entry.blob, {
      fileName: entry.name,
      contentType: entry.mime,
      signal: controller.signal,
      onProgress: (f) => patchEntry(conversationId, clientId, { progress: f }),
    })
    // Upload done → hand to the normal paced dispatcher (one send per file).
    patchEntry(conversationId, clientId, { status: 'sending', progress: 1 })
    const res = await sendMessage({
      conversationId,
      kind: entry.kind,
      mediaStorageKey: up.key,
      mediaStorageBucket: up.bucket,
      mediaMime: up.mime,
      mediaSizeBytes: up.size,
      body: entry.caption.trim() || undefined,
      // STABLE key: a retry after a lost send response dedups server-side
      // instead of enqueuing a second copy to the customer.
      idempotencyKey: entry.idempotencyKey,
      // Voice-note (recording) → ptt path; ptt media_meta makes the thread
      // render it as a recording. Otherwise a normal file / gif.
      ...(entry.ptt ? { ptt: true } : {}),
      mediaMeta: entry.ptt
        ? { ptt: true }
        : { fileName: entry.name, ...(entry.isGif ? { isGif: true, gifPlayback: true } : {}) },
    })
    controllers.delete(clientId)
    // Keep the bubble until the REAL row (res.message_id) lands in the thread —
    // the render layer drops it then, so there's no gap/flicker.
    patchEntry(conversationId, clientId, { sentMessageId: res.message_id })
    // Safety-net GC: if the user navigates away from this conversation before
    // the real row lands (the render-effect removal only runs for the mounted
    // ChatPane), drop the entry + revoke its object URL after a grace window.
    setTimeout(() => {
      const still = findEntry(clientId)
      if (still && still.sentMessageId) removePendingUpload(clientId)
    }, 8000)
  } catch {
    controllers.delete(clientId)
    // 'cancelled' (set by abortPendingUpload) is preserved so the bubble shows
    // "Annulé" not "Échec"; a genuine failure keeps cancelled=false.
    patchEntry(conversationId, clientId, { status: 'error' })
  }
}

/** Cancel an in-flight upload (X button). Marks it cancelled, then aborts the
 *  XHR → run()'s catch lands in 'error' with a retry affordance (per the owner:
 *  X stops the send and offers "Réessayer"). */
export function abortPendingUpload(clientId: string): void {
  patchEntry(findEntry(clientId)?.conversationId ?? '', clientId, { cancelled: true })
  controllers.get(clientId)?.abort()
}

/** Re-run upload + send for a failed/cancelled entry (retry button). */
export function retryPendingUpload(clientId: string): void {
  const entry = findEntry(clientId)
  if (!entry || entry.status !== 'error') return
  patchEntry(entry.conversationId, clientId, { status: 'uploading', progress: 0, cancelled: false })
  void run(clientId)
}

/** Remove an entry (real row arrived, or user dismissed a failed one). Aborts
 *  any in-flight upload and revokes the local preview URL. */
export function removePendingUpload(clientId: string): void {
  controllers.get(clientId)?.abort()
  controllers.delete(clientId)
  for (const [conv, list] of byConv) {
    const target = list.find((e) => e.clientId === clientId)
    if (!target) continue
    URL.revokeObjectURL(target.localBlobUrl)
    setList(conv, list.filter((e) => e.clientId !== clientId))
    return
  }
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

/** Pending optimistic uploads for one conversation (stable [] when none). */
export function usePendingUploads(conversationId: string | null | undefined): PendingUpload[] {
  return useSyncExternalStore(
    subscribe,
    () => (conversationId ? byConv.get(conversationId) ?? EMPTY : EMPTY),
  )
}
