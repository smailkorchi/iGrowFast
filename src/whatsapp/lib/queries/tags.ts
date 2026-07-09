import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'

export interface Tag {
  id: string
  instance_id: string
  name: string
  color: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ConversationTag {
  id: string
  conversation_id: string
  tag_id: string
  created_at: string
}

export const tagKeys = {
  all: ['tags'] as const,
  list: (instanceId: string) => ['tags', 'list', instanceId] as const,
  conversationTags: (conversationId: string) => ['conversation_tags', conversationId] as const,
  allConversationTags: (instanceId: string) => ['conversation_tags', 'instance', instanceId] as const,
}

export function useTags(instanceId: string | null) {
  return useQuery<Tag[]>({
    queryKey: tagKeys.list(instanceId ?? '_'),
    queryFn: async () => {
      if (!instanceId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('tags')
        .select('*')
        .eq('instance_id', instanceId)
        .order('name')
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as Tag[]
    },
    enabled: !!instanceId,
    staleTime: 60_000,
  })
}

export function useConversationTags(conversationId: string | null) {
  return useQuery<ConversationTag[]>({
    queryKey: tagKeys.conversationTags(conversationId ?? '_'),
    queryFn: async () => {
      if (!conversationId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('conversation_tags')
        .select('*')
        .eq('conversation_id', conversationId)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as ConversationTag[]
    },
    enabled: !!conversationId,
    staleTime: 30_000,
  })
}

export function useAllConversationTags(instanceId: string | null) {
  return useQuery<ConversationTag[]>({
    queryKey: tagKeys.allConversationTags(instanceId ?? '_'),
    queryFn: async () => {
      if (!instanceId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('conversation_tags')
        .select('*, tags!inner(instance_id)')
        .eq('tags.instance_id', instanceId)
      if (error) throw new Error(error.message)
      return (data ?? []).map((d: Record<string, unknown>) => ({
        id: d.id as string,
        conversation_id: d.conversation_id as string,
        tag_id: d.tag_id as string,
        created_at: d.created_at as string,
      }))
    },
    enabled: !!instanceId,
    staleTime: 30_000,
  })
}

export function useCreateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { instanceId: string; name: string; color: string }) => {
      const { data, error } = await supabase
        .schema('whatsapp').from('tags')
        .insert({ instance_id: params.instanceId, name: params.name, color: params.color })
        .select()
        .single()
      if (error) throw new Error(error.message)
      return data as unknown as Tag
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: tagKeys.list(v.instanceId) })
    },
  })
}

export function useUpdateTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { id: string; instanceId: string; name: string; color: string }) => {
      const { error } = await supabase
        .schema('whatsapp').from('tags')
        .update({ name: params.name, color: params.color })
        .eq('id', params.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: tagKeys.list(v.instanceId) })
    },
  })
}

export function useDeleteTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { id: string; instanceId: string }) => {
      const { error } = await supabase.schema('whatsapp').from('tags').delete().eq('id', params.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: tagKeys.list(v.instanceId) })
      void qc.invalidateQueries({ queryKey: ['conversation_tags'] })
    },
  })
}

export function useAssignTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { conversationId: string; tagId: string }) => {
      const { error } = await supabase
        .schema('whatsapp').from('conversation_tags')
        .insert({ conversation_id: params.conversationId, tag_id: params.tagId })
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: tagKeys.conversationTags(v.conversationId) })
      void qc.invalidateQueries({ queryKey: ['conversation_tags'] })
    },
  })
}

export function useUnassignTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { conversationId: string; tagId: string }) => {
      const { error } = await supabase
        .schema('whatsapp').from('conversation_tags')
        .delete()
        .eq('conversation_id', params.conversationId)
        .eq('tag_id', params.tagId)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: tagKeys.conversationTags(v.conversationId) })
      void qc.invalidateQueries({ queryKey: ['conversation_tags'] })
    },
  })
}
