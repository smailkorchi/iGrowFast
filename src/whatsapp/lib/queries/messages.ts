// Messages query layer for a single thread.
//
// Strategy: infinite query loading PAGE_SIZE rows at a time backwards in time
// (older first when the user scrolls up). The newest page is the first page;
// the consumer reverses it once for display.
//
// Realtime: subscribe to messages INSERT + UPDATE filtered by conversation_id;
// patch the cache in place rather than refetching (smooth thread experience).

import { useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { useAuth } from '../auth'
import type { MessageDecrypted } from '../database.types'

export const messageKeys = {
  thread: (conversationId: string) => ['messages', 'thread', conversationId] as const,
}

const PAGE_SIZE = 50

interface ThreadPage {
  rows: MessageDecrypted[]
  /** ISO timestamp of the oldest row in this page; used as cursor. */
  oldestTs: string | null
  hasMore: boolean
}

/**
 * Paginated thread query. `pageParam` is the ISO timestamp of the OLDEST
 * row we've already loaded; we ask for rows older than that.
 *
 * Returned pages are in chronological reverse (newest → oldest) per page,
 * but newer pages come first (pageParam=null → newest page).
 */
export function useThreadMessages(conversationId: string | null) {
  return useInfiniteQuery({
    queryKey: conversationId ? messageKeys.thread(conversationId) : ['messages', 'thread', '_'],
    enabled: !!conversationId,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      if (!conversationId) return { rows: [] as MessageDecrypted[], oldestTs: null, hasMore: false }
      let q = supabase
        .schema('whatsapp').from('messages_decrypted')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('whatsapp_timestamp', { ascending: false })
        .limit(PAGE_SIZE)
      if (pageParam) {
        q = q.lt('whatsapp_timestamp', pageParam)
      }
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as MessageDecrypted[]
      const oldest = rows.length ? rows[rows.length - 1]!.whatsapp_timestamp : null
      return {
        rows,
        oldestTs: oldest,
        hasMore: rows.length === PAGE_SIZE,
      } satisfies ThreadPage
    },
    getNextPageParam: (last) => (last.hasMore ? last.oldestTs : null),
  })
}

/** Flatten all loaded pages in chronological order (oldest → newest). */
export function useFlattenedThread(conversationId: string | null) {
  const q = useThreadMessages(conversationId)
  const messages = useMemo(() => {
    const pages = q.data?.pages ?? []
    // Each page is newest→oldest; flatten reversed so result is oldest→newest.
    const all: MessageDecrypted[] = []
    for (let i = pages.length - 1; i >= 0; i--) {
      const page = pages[i]!
      for (let j = page.rows.length - 1; j >= 0; j--) {
        all.push(page.rows[j]!)
      }
    }
    return all
  }, [q.data?.pages])
  return { ...q, messages }
}

/**
 * Realtime subscription for INSERT + UPDATE on messages for this conversation.
 * INSERT → prepend to the newest page if not already present.
 * UPDATE → in-place patch (delivery_status / reactions / is_starred etc.).
 */
export function useThreadRealtime(conversationId: string | null) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user.id ?? null
  const lastConvRef = useRef<string | null>(null)
  useEffect(() => {
    if (!conversationId) return
    lastConvRef.current = conversationId
    const channel = supabase
      .channel(`thread-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'whatsapp', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          // Re-fetch the single row through messages_decrypted to get the
          // decrypted body (the realtime payload only carries the raw row).
          const id = (payload.new as { id?: string }).id
          if (!id) return
          const { data } = await supabase
            .schema('whatsapp').from('messages_decrypted').select('*').eq('id', id).maybeSingle()
          if (!data) return
          qc.setQueryData<{ pages: ThreadPage[]; pageParams: unknown[] } | undefined>(
            messageKeys.thread(conversationId),
            (prev) => prev ? patchInsertNewest(prev, data as MessageDecrypted) : prev,
          )
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'whatsapp', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (payload) => {
          const id = (payload.new as { id?: string }).id
          if (!id) return
          const { data } = await supabase
            .schema('whatsapp').from('messages_decrypted').select('*').eq('id', id).maybeSingle()
          if (!data) {
            // The row is no longer visible to THIS agent through the view —
            // i.e. they just "deleted for me" (hidden_for_user_ids now contains
            // their uid). Drop it from their thread. Other agents' re-fetch
            // still returns the row (not hidden for them) and patches normally.
            qc.setQueryData<{ pages: ThreadPage[]; pageParams: unknown[] } | undefined>(
              messageKeys.thread(conversationId),
              (prev) => prev ? patchDelete(prev, id) : prev,
            )
            return
          }
          qc.setQueryData<{ pages: ThreadPage[]; pageParams: unknown[] } | undefined>(
            messageKeys.thread(conversationId),
            (prev) => prev ? patchUpdate(prev, data as MessageDecrypted) : prev,
          )
          // Keep the pinned-bar (which queries pinned rows directly, incl. those
          // outside the loaded window) in sync on pin/unpin for every agent.
          void qc.invalidateQueries({ queryKey: ['pinnedBar', conversationId] })
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'whatsapp', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          // A cancelled (never-dispatched) message is hard-deleted server-side.
          // Drop the bubble from the thread. DELETE payloads carry only the
          // primary key in `old`.
          const id = (payload.old as { id?: string }).id
          if (!id) return
          qc.setQueryData<{ pages: ThreadPage[]; pageParams: unknown[] } | undefined>(
            messageKeys.thread(conversationId),
            (prev) => prev ? patchDelete(prev, id) : prev,
          )
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [conversationId, qc])

  // ADDITIVE (migration 040): private wa:conv:<id> broadcast carrying the DECRYPTED
  // message — patches the thread with ZERO re-fetch (the postgres_changes path
  // above re-fetches every event). Runs ALONGSIDE postgres_changes and dedupes by
  // id (patchInsertNewest skips dupes, patchUpdate is idempotent), so double
  // delivery is harmless; postgres_changes stays authoritative until it is removed
  // and messages leaves the realtime publication (the ~62.6% list_changes win).
  // Separate effect (keyed on uid too) so the postgres_changes channel above is
  // untouched. Delete-for-me is applied client-side via hidden_for_user_ids.
  useEffect(() => {
    if (!conversationId) return
    const key = messageKeys.thread(conversationId)
    const patch = (
      fn: (prev: { pages: ThreadPage[]; pageParams: unknown[] }) => { pages: ThreadPage[]; pageParams: unknown[] },
    ) => qc.setQueryData<{ pages: ThreadPage[]; pageParams: unknown[] } | undefined>(
      key, (prev) => prev ? fn(prev) : prev,
    )
    const ch = supabase
      .channel(`wa:conv:${conversationId}`, { config: { private: true } })
      .on('broadcast', { event: 'msg' }, ({ payload }) => {
        const p = payload as (MessageDecrypted & { op?: string; deleted?: boolean; hidden_for_user_ids?: string[] }) | null
        const id = p?.id
        if (!id) return
        // Tombstone (cancelled/hard-deleted message).
        if (p!.deleted) { patch((prev) => patchDelete(prev, id)); return }
        // Delete-for-me: hidden for THIS agent → drop it from their thread only.
        if (uid && Array.isArray(p!.hidden_for_user_ids) && p!.hidden_for_user_ids.includes(uid)) {
          patch((prev) => patchDelete(prev, id)); return
        }
        const row = p as MessageDecrypted
        if (p!.op === 'INSERT') {
          patch((prev) => patchInsertNewest(prev, row))
        } else {
          patch((prev) => patchUpdate(prev, row))
          void qc.invalidateQueries({ queryKey: ['pinnedBar', conversationId] })
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Private-channel auth failed / socket dropped; postgres_changes above
          // keeps the thread correct. Surface for diagnostics.
          console.warn(`[wa-thread] wa:conv:${conversationId} status=${status}`)
        }
      })
    return () => { void supabase.removeChannel(ch) }
  }, [conversationId, uid, qc])
}

function patchInsertNewest(
  prev: { pages: ThreadPage[]; pageParams: unknown[] },
  row: MessageDecrypted,
): { pages: ThreadPage[]; pageParams: unknown[] } {
  if (prev.pages.length === 0) return prev
  // dedupe: skip if any page already has this id
  for (const p of prev.pages) {
    if (p.rows.some((m) => m.id === row.id)) return prev
  }
  const [first, ...rest] = prev.pages as [ThreadPage, ...ThreadPage[]]
  const merged: ThreadPage = {
    ...first,
    rows: [row, ...first.rows],
  }
  return { ...prev, pages: [merged, ...rest] }
}

function patchUpdate(
  prev: { pages: ThreadPage[]; pageParams: unknown[] },
  row: MessageDecrypted,
): { pages: ThreadPage[]; pageParams: unknown[] } {
  let changed = false
  const next = prev.pages.map((p) => {
    if (!p.rows.some((m) => m.id === row.id)) return p
    changed = true
    return { ...p, rows: p.rows.map((m) => (m.id === row.id ? row : m)) }
  })
  return changed ? { ...prev, pages: next } : prev
}

// Remove a message (by id) from every page — used when a never-sent message
// is cancelled/hard-deleted server-side.
function patchDelete(
  prev: { pages: ThreadPage[]; pageParams: unknown[] },
  id: string,
): { pages: ThreadPage[]; pageParams: unknown[] } {
  let changed = false
  const next = prev.pages.map((p) => {
    if (!p.rows.some((m) => m.id === id)) return p
    changed = true
    return { ...p, rows: p.rows.filter((m) => m.id !== id) }
  })
  return changed ? { ...prev, pages: next } : prev
}
