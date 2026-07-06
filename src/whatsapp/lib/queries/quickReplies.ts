import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../supabase'

// ─── Node-sequence model (shared by quick replies + scheduled messages) ──────
//
// A quick reply / scheduled message is an ORDERED list of message nodes ("steps")
// dispatched in exactly the saved order. A step is either a text node or a media
// node. Audio is split into two distinct node types: `voice` (WhatsApp voice
// note, ptt=true) and `audio_file` (audio document, ptt=false).

/** Media node types. `voice` = voice note (ptt), `audio_file` = audio document. */
export type MediaStepType = 'image' | 'video' | 'document' | 'voice' | 'audio_file'
export type StepType = 'text' | MediaStepType

export interface TextStep {
  id: string
  type: 'text'
  body: string
}

export interface MediaStep {
  id: string
  type: MediaStepType
  r2_key: string
  r2_bucket: string
  mime: string
  size_bytes: number
  file_name: string
  /** Audio clip length in seconds (voice + audio_file), captured at authoring.
   *  Drives the worker's `recording` presence window so a canned voice note
   *  looks recorded in real time. */
  seconds?: number
}

export type MessageStep = TextStep | MediaStep

export function isTextStep(s: MessageStep): s is TextStep {
  return s.type === 'text'
}
export function isMediaStep(s: MessageStep): s is MediaStep {
  return s.type !== 'text'
}

/** One-line preview for list rows: first non-empty text node, else a count. */
export function stepsSummary(steps: MessageStep[] | null | undefined): string {
  if (!steps?.length) return ''
  const firstText = steps.find((s): s is TextStep => s.type === 'text' && !!s.body.trim())
  if (firstText) return firstText.body
  return `${steps.length} élément${steps.length > 1 ? 's' : ''}`
}

export interface QuickReply {
  id: string
  business_id: string
  name: string
  steps: MessageStep[]
  created_by: string | null
  created_at: string
  updated_at: string
}

// ─── IGF ADAPTATION (build plan "ADAPT": quick_replies → per-business) ──────
// On the box, quick_replies is BUSINESS-scoped: WA Mancer's instance_id column
// became business_id (canned replies are shared across all of a business's
// numbers; RLS + unique index re-keyed accordingly). The donor UI thinks in
// instances, so every exported hook KEEPS its instanceId signature and we
// resolve the owning business once per instance (immutable — cached forever).
const bizCache = new Map<string, string>()
async function businessIdOf(instanceId: string): Promise<string> {
  const hit = bizCache.get(instanceId)
  if (hit) return hit
  const { data, error } = await supabase
    .schema('whatsapp').from('whatsapp_instances')
    .select('business_id')
    .eq('id', instanceId)
    .single()
  if (error) throw new Error(error.message)
  const biz = (data as { business_id: string }).business_id
  bizCache.set(instanceId, biz)
  return biz
}

export const quickReplyKeys = {
  all: ['quick_replies'] as const,
  list: (instanceId: string) => ['quick_replies', 'list', instanceId] as const,
}

export function useQuickReplies(instanceId: string | null) {
  return useQuery<QuickReply[]>({
    queryKey: quickReplyKeys.list(instanceId ?? '_'),
    queryFn: async () => {
      if (!instanceId) return []
      const biz = await businessIdOf(instanceId)
      const { data, error } = await supabase
        .schema('whatsapp').from('quick_replies')
        .select('*')
        .eq('business_id', biz)
        .order('name')
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as QuickReply[]
    },
    enabled: !!instanceId,
    staleTime: 60_000,
  })
}

export function useQuickRepliesRealtime(instanceId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!instanceId) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false
    void businessIdOf(instanceId)
      .then((biz) => {
        if (cancelled) return
        channel = supabase
          .channel(`qr-${instanceId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'whatsapp', table: 'quick_replies', filter: `business_id=eq.${biz}` },
            () => { void qc.invalidateQueries({ queryKey: quickReplyKeys.list(instanceId) }) },
          )
          .subscribe()
      })
      .catch(() => { /* resolver failure surfaces through the list query */ })
    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [instanceId, qc])
}

export function useCreateQuickReply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      instanceId: string
      name: string
      steps: MessageStep[]
    }) => {
      const biz = await businessIdOf(params.instanceId)
      const { error } = await supabase.schema('whatsapp').from('quick_replies').insert({
        business_id: biz,
        name: params.name,
        steps: params.steps as unknown as never,
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: quickReplyKeys.list(v.instanceId) })
    },
  })
}

export function useUpdateQuickReply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      id: string
      instanceId: string
      name: string
      steps: MessageStep[]
    }) => {
      const { error } = await supabase
        .schema('whatsapp').from('quick_replies')
        .update({
          name: params.name,
          steps: params.steps as unknown as never,
        })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: quickReplyKeys.list(v.instanceId) })
    },
  })
}

export function useDeleteQuickReply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { id: string; instanceId: string }) => {
      const { error } = await supabase.schema('whatsapp').from('quick_replies').delete().eq('id', params.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: quickReplyKeys.list(v.instanceId) })
    },
  })
}

// ─── audio duration capture ────────────────────────────────────────────────
//
// Decode an audio file's length in seconds at authoring time. Used to size the
// worker's `recording` presence window for canned voice notes. Web Audio's
// decodeAudioData reports duration reliably for ogg/opus/mp3/wav/m4a (unlike a
// bare <audio> element, whose duration is often NaN for ogg until played).
// Best-effort: returns undefined on any failure (worker falls back gracefully).
export async function decodeAudioDurationSeconds(file: File | Blob): Promise<number | undefined> {
  try {
    const AC = (window.AudioContext
      || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    if (!AC) return undefined
    const buf = await file.arrayBuffer()
    const ctx = new AC()
    try {
      const decoded = await ctx.decodeAudioData(buf.slice(0))
      const sec = decoded.duration
      return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 10) / 10 : undefined
    } finally {
      void ctx.close().catch(() => { /* noop */ })
    }
  } catch {
    return undefined
  }
}

// ─── R2 upload for quick reply media ──────────────────────────────────────

interface QrMediaUploadResponse {
  ok: boolean
  bucket?: string
  key?: string
  url?: string
  expires_at?: string
  max_bytes?: number
  reason?: string
}

export async function uploadQuickReplyMedia(
  instanceId: string,
  file: File,
): Promise<{ r2_key: string; r2_bucket: string; mime: string; size_bytes: number; file_name: string }> {
  const mime = file.type || 'application/octet-stream'
  const size = file.size
  if (!size) throw new Error('File is empty')

  const { data, error } = await supabase.functions.invoke<QrMediaUploadResponse>('media-upload', {
    body: {
      instance_id: instanceId,
      purpose: 'quick_reply',
      mime,
      size_bytes: size,
    },
  })
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<QrMediaUploadResponse> } }).context
    const body = await ctx?.json?.().catch(() => undefined)
    throw new Error(body?.reason ?? error.message)
  }
  if (!data?.ok || !data.url || !data.key || !data.bucket) {
    throw new Error(data?.reason ?? 'signing failed')
  }

  const putRes = await fetch(data.url, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(size),
    },
  })
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '')
    throw new Error(`R2 PUT failed: ${putRes.status} ${text.slice(0, 200)}`)
  }

  return {
    r2_key: data.key,
    r2_bucket: data.bucket,
    mime,
    size_bytes: size,
    file_name: file.name,
  }
}
