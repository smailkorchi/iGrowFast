// Scheduled messages — per-conversation drafts queued for a future fire time.
// Same media-attachment shape as quick replies so the composer can hand off a
// scheduled item back to the active draft (used by the '#' picker).
//
// The dispatcher worker is intentionally NOT wired yet — this file only
// handles authoring CRUD + realtime, so the UI can be built end-to-end before
// sending mechanics land.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { supabase } from '../supabase'
import type { MessageStep } from './quickReplies'

export type ScheduledMessageStatus = 'pending' | 'sent' | 'cancelled' | 'failed'

export interface ScheduledMessage {
  id: string
  instance_id: string
  conversation_id: string
  name: string
  steps: MessageStep[]
  scheduled_at: string
  status: ScheduledMessageStatus
  sent_at: string | null
  failure_reason: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const scheduledMessageKeys = {
  all:  ['scheduled_messages'] as const,
  list: (conversationId: string) => ['scheduled_messages', 'list', conversationId] as const,
}

export function useScheduledMessages(conversationId: string | null) {
  return useQuery<ScheduledMessage[]>({
    queryKey: scheduledMessageKeys.list(conversationId ?? '_'),
    queryFn: async () => {
      if (!conversationId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('scheduled_messages' as never)
        .select('*')
        .eq('conversation_id', conversationId)
        .order('scheduled_at', { ascending: true }) as unknown as {
          data: ScheduledMessage[] | null
          error: { message: string } | null
        }
      if (error) throw new Error(error.message)
      return data ?? []
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  })
}

export function useScheduledMessagesRealtime(conversationId: string | null) {
  const qc = useQueryClient()
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`sm-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'whatsapp',
          table: 'scheduled_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => { void qc.invalidateQueries({ queryKey: scheduledMessageKeys.list(conversationId) }) },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [conversationId, qc])
}

export function useCreateScheduledMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      instanceId: string
      conversationId: string
      name: string
      steps: MessageStep[]
      scheduledAt: string  // ISO timestamp, must be in the future
    }) => {
      const { error } = await supabase.schema('whatsapp').from('scheduled_messages' as never).insert({
        instance_id:     params.instanceId,
        conversation_id: params.conversationId,
        name:            params.name,
        steps:           params.steps,
        scheduled_at:    params.scheduledAt,
      } as never)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: scheduledMessageKeys.list(v.conversationId) })
    },
  })
}

export function useUpdateScheduledMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      id: string
      conversationId: string
      name: string
      steps: MessageStep[]
      scheduledAt: string
    }) => {
      const { error } = await supabase
        .schema('whatsapp').from('scheduled_messages' as never)
        .update({
          name:         params.name,
          steps:        params.steps,
          scheduled_at: params.scheduledAt,
        } as never)
        .eq('id', params.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: scheduledMessageKeys.list(v.conversationId) })
    },
  })
}

export function useDeleteScheduledMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { id: string; conversationId: string }) => {
      const { error } = await supabase
        .schema('whatsapp').from('scheduled_messages' as never)
        .delete()
        .eq('id', params.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: scheduledMessageKeys.list(v.conversationId) })
    },
  })
}

// ── R2 upload for scheduled message media ───────────────────────────────────

interface SmMediaUploadResponse {
  ok: boolean
  bucket?: string
  key?: string
  url?: string
  expires_at?: string
  max_bytes?: number
  reason?: string
}

export async function uploadScheduledMessageMedia(
  conversationId: string,
  file: File,
): Promise<{ r2_key: string; r2_bucket: string; mime: string; size_bytes: number; file_name: string }> {
  const mime = file.type || 'application/octet-stream'
  const size = file.size
  if (!size) throw new Error('File is empty')

  const { data, error } = await supabase.functions.invoke<SmMediaUploadResponse>('media-upload', {
    body: {
      conversation_id: conversationId,
      purpose:         'scheduled_message',
      mime,
      size_bytes:      size,
    },
  })
  if (error) {
    const ctx = (error as { context?: { json?: () => Promise<SmMediaUploadResponse> } }).context
    const body = await ctx?.json?.().catch(() => undefined)
    throw new Error(body?.reason ?? error.message)
  }
  if (!data?.ok || !data.url || !data.key || !data.bucket) {
    throw new Error(data?.reason ?? 'signing failed')
  }

  const putRes = await fetch(data.url, {
    method:  'PUT',
    body:    file,
    headers: { 'Content-Type': mime, 'Content-Length': String(size) },
  })
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '')
    throw new Error(`R2 PUT failed: ${putRes.status} ${text.slice(0, 200)}`)
  }

  return {
    r2_key:     data.key,
    r2_bucket:  data.bucket,
    mime,
    size_bytes: size,
    file_name:  file.name,
  }
}
