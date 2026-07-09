// /admin/assignment
//
// Two-pane routing console for admins. Left: conversation pool filterable by
// assignment state + searchable + multi-selectable. Right: agent roster with
// live load counts that doubles as the assign-action target. Top: auto-assign
// configuration per instance.
//
// All writes go through the SECURITY DEFINER RPCs in assignmentApi.ts —
// is_admin() gates inside the function. Realtime sync rides the unified wa:biz
// broadcast (AdminWaRealtime, mounted in the page wrapper) so every admin
// session reflects the same state without polling.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import Avatar from '../../components/Avatar/Avatar'
import type { WhatsappInstance } from '../../lib/database.types'
import { useAuth } from '../../lib/auth'
import { useInstances } from '../../lib/queries/instances'
import { useProfiles } from '../../lib/queries/users'
import { useDeleteScheduledMessage } from '../../lib/queries/scheduledMessages'
import { UnassignScheduledModal } from './conversations/UnassignScheduledModal'
import { supabase } from '../../lib/supabase'
import { toast, normalizeError } from '../../lib/toast/store'
import {
  assignmentKeys,
  useApplyAutoAssignBacklog,
  useBulkAssign,
  useBulkUnassign,
  useInstanceAssignments,
  useSetAutoAssign,
  useSetConversationAssignees,
  useUnassignConversationUser,
} from '../../lib/queries/assignments'
import {
  useFlattenedConversations,
  type ConversationListRow,
} from '../../lib/queries/conversations'
import type { AvatarConfig } from '../../lib/database.types'
import { conversationLabel } from '../../lib/jid'
import './Assignment.css'

type FilterChip = 'unassigned' | 'one' | 'many' | 'dms' | 'groups' | 'all'
const CHIP_LABELS: Record<FilterChip, string> = {
  unassigned: 'Non assignées',
  one:        'Assignées à un',
  many:       'Assignées à plusieurs',
  dms:        'DM',
  groups:     'Groupes',
  all:        'Toutes',
}

export default function AdminAssignment() {
  // ── data ──────────────────────────────────────────────────────────────────
  const qc = useQueryClient()
  const { profile: me } = useAuth()
  const { data: instances }      = useInstances()
  const { data: allProfiles }    = useProfiles()
  const defaultInstanceId        = useMemo(() => {
    if (!instances || instances.length === 0) return null
    return (instances.find((i) => i.status === 'connected') ?? instances[0])?.id ?? null
  }, [instances])
  // Admin's manual instance pick; null means "use the default once it's known".
  const [instanceOverride, setInstanceOverride] = useState<string | null>(null)
  const instanceId = instanceOverride ?? defaultInstanceId

  const activeInstance = instances?.find((i) => i.id === instanceId) ?? null

  // conversations + assignment realtime ride the unified wa:biz channel
  // (AdminWaRealtime in the page wrapper) — no per-page channels here.

  const convs           = useFlattenedConversations(instanceId, 'all')
  const assignmentsQ    = useInstanceAssignments(instanceId)

  // Roster = active non-admin users only. Admins already have full access
  // to every conversation via RLS; routing them is meaningless.
  // KNOWN GAP (deferred): our _guard_assignment_business trigger only permits
  // role='commercial' as an assignee, but the whatsapp.profiles view collapses
  // the real role to 'admin'|'user', so we can't filter to commercial here.
  // If a business ever exposes a non-commercial non-admin role (media buyer,
  // courier) in this list, assigning to them aborts the batch. Proper fix needs
  // the profiles view to surface the real role / an is_assignable flag.
  const agents = useMemo(
    () => (allProfiles ?? []).filter((p) => p.is_active && p.role !== 'admin'),
    [allProfiles],
  )

  // ── assignments index: convId → user_id[] ─────────────────────────────────
  const assignmentsByConv = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const a of assignmentsQ.data ?? []) {
      const arr = m.get(a.conversation_id) ?? []
      arr.push(a.user_id)
      m.set(a.conversation_id, arr)
    }
    return m
  }, [assignmentsQ.data])

  // ── client-side narrowing: chips + search ─────────────────────────────────
  const [chip, setChip] = useState<FilterChip>('unassigned')
  const [search, setSearch] = useState('')

  // Identical visibility rules to /admin/conversations:
  //   1. Hide unresolved @lid DMs (no book_name). Phone-JID DMs always visible.
  //      Groups always visible.
  //   2. Deduplicate by contact_id: keep the phone-JID conversation, hide
  //      the @lid sibling when the contact has been resolved.
  //   3. Search/chip narrowing happens downstream in visibleRows.
  const baseRows = useMemo(() => {
    let rows = convs.rows

    // 1) hide unresolved @lid DMs
    rows = rows.filter((c) => {
      if (c.is_group) return true
      const jid = c.remote_jid ?? ''
      if (jid.endsWith('@s.whatsapp.net')) return true
      return !!c.contact_book_name
    })

    // 2) dedup @lid siblings when a phone JID exists for the same contact_id
    const contactIdToPhone = new Set<string>()
    for (const c of rows) {
      if (c.contact_id && c.remote_jid && !c.remote_jid.endsWith('@lid')) {
        contactIdToPhone.add(c.contact_id)
      }
    }
    rows = rows.filter((c) => {
      if (!c.contact_id) return true
      const jid = c.remote_jid ?? ''
      if (!jid.endsWith('@lid')) return true
      return !contactIdToPhone.has(c.contact_id)
    })

    return rows
  }, [convs.rows])

  // openCountsByUser is derived from baseRows (resolved conversations) so it
  // matches what the inbox shows. A stray assignment against an unresolved
  // conversation cannot inflate the count. Backend cleans these up too;
  // this is defense-in-depth.
  const openCountsByUser = useMemo(() => {
    const visibleIds = new Set<string>()
    for (const r of baseRows) if (r.id) visibleIds.add(r.id)
    const m = new Map<string, number>()
    for (const a of assignmentsQ.data ?? []) {
      if (!visibleIds.has(a.conversation_id)) continue
      m.set(a.user_id, (m.get(a.user_id) ?? 0) + 1)
    }
    return m
  }, [assignmentsQ.data, baseRows])

  const chipCounts = useMemo(() => {
    const out = { unassigned: 0, one: 0, many: 0, dms: 0, groups: 0, all: baseRows.length }
    for (const c of baseRows) {
      const n = assignmentsByConv.get(c.id ?? '')?.length ?? 0
      if (n === 0) out.unassigned += 1
      else if (n === 1) out.one += 1
      else out.many += 1
      if (c.is_group) out.groups += 1
      else            out.dms += 1
    }
    return out
  }, [baseRows, assignmentsByConv])

  const visibleRows = useMemo(() => {
    let rows = baseRows
    rows = rows.filter((c) => {
      const n = assignmentsByConv.get(c.id ?? '')?.length ?? 0
      if (chip === 'unassigned') return n === 0
      if (chip === 'one')        return n === 1
      if (chip === 'many')       return n >= 2
      if (chip === 'dms')        return c.is_group === false
      if (chip === 'groups')     return c.is_group === true
      return true
    })
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((c) => {
        const label = conversationLabel(c.remote_jid ?? '', c.peer_display_name, c.contact_book_name).toLowerCase()
        const jid   = (c.remote_jid ?? '').toLowerCase()
        return label.includes(q) || jid.includes(q)
      })
    }
    return rows
  }, [baseRows, chip, search, assignmentsByConv])

  // ── selection ─────────────────────────────────────────────────────────────
  // Reset selection when the filter context changes. Canonical key-based
  // pattern from the React docs (avoid effect-driven cascades).
  const selectionContextKey = `${instanceId ?? ''}|${chip}`
  const [selectionKey, setSelectionKey] = useState(selectionContextKey)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  if (selectionKey !== selectionContextKey) {
    setSelectionKey(selectionContextKey)
    setSelectedIds(new Set())
  }

  // Selection kind is derived from the first selected item. Mode-locked:
  // selection is always homogeneous (all DMs or all groups). Clicking a row
  // of the other kind silently resets the selection to just that row.
  type SelKind = 'dm' | 'group' | null
  let selectionKind: SelKind = null
  if (selectedIds.size > 0) {
    const first = visibleRows.find((r) => r.id && selectedIds.has(r.id))
    if (first) selectionKind = first.is_group ? 'group' : 'dm'
  }

  function toggleSelected(id: string) {
    const row = visibleRows.find((r) => r.id === id)
    if (!row) return
    const rowKind: SelKind = row.is_group ? 'group' : 'dm'
    setSelectedIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) { next.delete(id); return next }
      // Kind mismatch with existing selection → mode-switch: drop everything,
      // keep only the new item. Friendlier than blocking the click.
      if (cur.size > 0) {
        const firstId = visibleRows.find((r) => r.id && cur.has(r.id))
        const existingKind: SelKind = firstId ? (firstId.is_group ? 'group' : 'dm') : null
        if (existingKind !== rowKind) return new Set([id])
      }
      next.add(id)
      return next
    })
  }
  function selectAllVisible() {
    // If a kind is already locked, only pull in visible rows of that kind;
    // otherwise lock to the first visible row's kind and grab all of those.
    const firstVisible = visibleRows.find((r) => r.id != null)
    if (!firstVisible) return
    const lockKind: SelKind = selectionKind ?? (firstVisible.is_group ? 'group' : 'dm')
    setSelectedIds(new Set(
      visibleRows
        .filter((r) => !!r.id && (r.is_group ? 'group' : 'dm') === lockKind)
        .map((r) => r.id!),
    ))
  }
  function clearSelection() { setSelectedIds(new Set()) }

  // ── multi-agent picker (groups chip only) ─────────────────────────────────
  // On the Groups tab with ≥1 group selected, agent cards sprout a checkbox.
  // Cards stay neutral until checked; an "Assign to N agents" button appears
  // in the conv-pane bulk header once any agent is picked. State resets on
  // chip/instance change via the same key-reset pattern as selectedIds.
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(() => new Set())
  if (selectionKey !== selectionContextKey && selectedAgentIds.size > 0) {
    setSelectedAgentIds(new Set())
  }
  function toggleAgentSelected(id: string) {
    setSelectedAgentIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectedGroupIds = useMemo(
    () => visibleRows.filter((r) => r.id && selectedIds.has(r.id) && r.is_group).map((r) => r.id!),
    [visibleRows, selectedIds],
  )
  // Multi-agent picker activates whenever the selection contains ≥1 group —
  // independent of which chip is active. Groups support many assignees; DMs
  // in the same selection are silently skipped by assignSelectedGroupsToAgents.
  const agentPickerActive = selectedGroupIds.length > 0

  // ── mutations ─────────────────────────────────────────────────────────────
  const setAssignees    = useSetConversationAssignees()
  const unassignOne     = useUnassignConversationUser()
  const bulkAssignMut   = useBulkAssign()
  const bulkUnassignMut = useBulkUnassign()
  const setAutoAssignMut = useSetAutoAssign()
  const applyBacklogMut  = useApplyAutoAssignBacklog()
  const deleteScheduledMut = useDeleteScheduledMessage()
  // Unassign-with-pending-scheduled-messages warning (same model as the inbox InfoPane).
  const [pendingUnassign, setPendingUnassign] = useState<
    { conversationId: string; userId: string; name: string; ids: string[] } | null
  >(null)
  // IGF ADDITION (donor gap): bulk unassign of the whole selection — the donor
  // shipped admin_unassign_conversations + useBulkUnassign but never wired a UI.
  const [pendingBulkUnassign, setPendingBulkUnassign] = useState<
    { pairs: Array<{ userId: string; conversationIds: string[] }>; smRows: Array<{ id: string; conversationId: string }> } | null
  >(null)

  async function assignSelectedToUser(targetUserId: string) {
    if (selectedIds.size === 0) return
    const targets = visibleRows.filter((r) => r.id && selectedIds.has(r.id))
    const dms     = targets.filter((c) => !c.is_group)
    const groups  = targets.filter((c) =>  c.is_group)

    // IGF FIX 2026-07-08 (the "29 stick / 21 roll back, retry doesn't help" bug):
    // the old code assigned DMs in a sequential per-row mutateAsync loop wrapped
    // in ONE try/catch — a single throw (e.g. a since-merged/deleted conversation
    // id lingering in the loaded page → conversation_not_found) aborted the whole
    // batch, leaving every later row unassigned; on retry the succeeded rows were
    // skipped and the loop hit the same bad row again → identical partial result.
    //   Fix: route UNOWNED DMs (the whole "Non assignées" pool) through the same
    //   bulk RPC as groups — one call, ON CONFLICT DO NOTHING, and (migration 025)
    //   stale/phantom ids are skipped server-side, never abort. Only DMs already
    //   owned by ANOTHER agent still need the per-row singleton SWAP, and that loop
    //   is now resilient (one failure is collected, not fatal). A final
    //   ['conversations'] refetch reconciles the pool from server truth so any
    //   stale id is purged.
    const unownedDmIds: string[] = []
    const swapDms: string[] = []
    for (const c of dms) {
      const cur = assignmentsByConv.get(c.id!) ?? []
      if (cur[0] === targetUserId) continue          // already this agent → nothing to do
      if (cur.length === 0) unownedDmIds.push(c.id!)  // pool case → bulk
      else                  swapDms.push(c.id!)       // owned by another → per-row swap
    }
    const groupIds = groups
      .filter((g) => !(assignmentsByConv.get(g.id!) ?? []).includes(targetUserId))
      .map((g) => g.id!)

    let failures = 0
    // Bulk-assignable ids (unowned DMs + groups) in one server call each.
    for (const ids of [unownedDmIds, groupIds]) {
      if (ids.length === 0) continue
      try {
        await bulkAssignMut.mutateAsync({ userId: targetUserId, conversationIds: ids, instanceId: instanceId ?? undefined, isGroup: ids === groupIds })
      } catch (e) { failures += ids.length; toast.error(normalizeError(e)) }
    }
    // Reassignment swaps: resilient — one failure never blocks the rest.
    const swapResults = await Promise.allSettled(
      swapDms.map((id) => setAssignees.mutateAsync({ conversationId: id, userIds: [targetUserId], instanceId: instanceId ?? undefined, isGroup: false })),
    )
    failures += swapResults.filter((r) => r.status === 'rejected').length

    // Reconcile the pool from server truth (drops assigned rows + purges any
    // stale/merged id that a client-cached page was still holding).
    void qc.invalidateQueries({ queryKey: ['conversations'] })
    void qc.invalidateQueries({ queryKey: assignmentKeys.byInstance(instanceId ?? '_') })

    clearSelection()
    if (failures > 0) toast.error(`${failures} conversation(s) n'ont pas pu être affectées.`)
  }

  async function removeAssignee(conversationId: string, userId: string) {
    try {
      // If this user has pending scheduled messages on the conversation, warn the
      // admin first (keep → cron still fires them, drop → delete the pending rows).
      // scheduled_messages isn't in the generated DB types (see scheduledMessages.ts) → cast the builder.
      const sm = supabase.schema('whatsapp').from('scheduled_messages' as never) as unknown as {
        select: (c: string) => {
          eq: (c2: string, v: string) => {
            eq: (c3: string, v3: string) => {
              eq: (c4: string, v4: string) => Promise<{ data: Array<{ id: string }> | null }>
            }
          }
        }
      }
      const { data } = await sm.select('id')
        .eq('conversation_id', conversationId)
        .eq('created_by', userId)
        .eq('status', 'pending')
      const ids = (data ?? []).map((r) => r.id)
      if (ids.length > 0) {
        const p = (allProfiles ?? []).find((x) => x.id === userId)
        setPendingUnassign({ conversationId, userId, name: p?.full_name || p?.email || 'Cet utilisateur', ids })
        return
      }
      await unassignOne.mutateAsync({ conversationId, userId, instanceId: instanceId ?? undefined })
    } catch (e) { toast.error(normalizeError(e)) }
  }

  async function resolveUnassign(drop: boolean) {
    const up = pendingUnassign
    if (!up) return
    setPendingUnassign(null)
    try {
      if (drop) {
        for (const id of up.ids) {
          await deleteScheduledMut.mutateAsync({ id, conversationId: up.conversationId })
        }
      }
      await unassignOne.mutateAsync({ conversationId: up.conversationId, userId: up.userId, instanceId: instanceId ?? undefined })
    } catch (e) { toast.error(normalizeError(e)) }
  }

  // IGF ADDITION (donor gap): clear EVERY assignee from the selected
  // conversations. Uses the donor's own admin_unassign_conversations RPC once
  // per distinct assignee. Same pending-scheduled-messages warning contract as
  // the single-row path, aggregated into one keep/drop modal for the batch.
  async function unassignSelected() {
    if (selectedIds.size === 0) return
    const byUser = new Map<string, string[]>()
    for (const convId of selectedIds) {
      for (const uid of assignmentsByConv.get(convId) ?? []) {
        const arr = byUser.get(uid) ?? []
        arr.push(convId)
        byUser.set(uid, arr)
      }
    }
    if (byUser.size === 0) { clearSelection(); return }
    const pairs = Array.from(byUser, ([userId, conversationIds]) => ({ userId, conversationIds }))
    try {
      const convIds = Array.from(new Set(pairs.flatMap((p) => p.conversationIds)))
      const sm = supabase.schema('whatsapp').from('scheduled_messages' as never) as unknown as {
        select: (c: string) => {
          in: (c2: string, v: string[]) => {
            eq: (c3: string, v3: string) => Promise<{ data: Array<{ id: string; conversation_id: string; created_by: string | null }> | null }>
          }
        }
      }
      const smRows: Array<{ id: string; conversationId: string }> = []
      const CHUNK = 150 // proxy URL limit — same chunking as listInstanceAssignments
      for (let i = 0; i < convIds.length; i += CHUNK) {
        const { data } = await sm.select('id, conversation_id, created_by')
          .in('conversation_id', convIds.slice(i, i + CHUNK))
          .eq('status', 'pending')
        for (const r of data ?? []) {
          if (r.created_by && (assignmentsByConv.get(r.conversation_id) ?? []).includes(r.created_by)) {
            smRows.push({ id: r.id, conversationId: r.conversation_id })
          }
        }
      }
      if (smRows.length > 0) {
        setPendingBulkUnassign({ pairs, smRows })
        return
      }
      await runBulkUnassign(pairs)
    } catch (e) { toast.error(normalizeError(e)) }
  }

  async function runBulkUnassign(pairs: Array<{ userId: string; conversationIds: string[] }>) {
    // Resilient (same fix as assign): one distinct-assignee failure must not
    // abort the rest of the batch.
    const results = await Promise.allSettled(
      pairs.map((p) => bulkUnassignMut.mutateAsync({ userId: p.userId, conversationIds: p.conversationIds, instanceId: instanceId ?? undefined })),
    )
    void qc.invalidateQueries({ queryKey: ['conversations'] })
    void qc.invalidateQueries({ queryKey: assignmentKeys.byInstance(instanceId ?? '_') })
    clearSelection()
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) toast.error(`${failed} désaffectation(s) ont échoué.`)
  }

  async function resolveBulkUnassign(drop: boolean) {
    const pb = pendingBulkUnassign
    if (!pb) return
    setPendingBulkUnassign(null)
    try {
      if (drop) {
        for (const row of pb.smRows) {
          await deleteScheduledMut.mutateAsync({ id: row.id, conversationId: row.conversationId })
        }
      }
      await runBulkUnassign(pb.pairs)
    } catch (e) { toast.error(normalizeError(e)) }
  }

  /**
   * Assign every currently-selected GROUP to every agent in `userIds`.
   * DMs in the selection are silently skipped (singleton constraint —
   * "assign one DM to many agents" isn't a valid operation).
   */
  async function assignSelectedGroupsToAgents(userIds: string[]) {
    if (selectedGroupIds.length === 0 || userIds.length === 0) return
    // Resilient per-group swap (a group can have many assignees, so no bulk RPC):
    // one failure never aborts the rest.
    const jobs: Array<{ convId: string; userIds: string[] }> = []
    for (const convId of selectedGroupIds) {
      const cur = new Set(assignmentsByConv.get(convId) ?? [])
      const before = cur.size
      for (const uid of userIds) cur.add(uid)
      if (cur.size !== before) jobs.push({ convId, userIds: Array.from(cur) })
    }
    const results = await Promise.allSettled(
      jobs.map((j) => setAssignees.mutateAsync({ conversationId: j.convId, userIds: j.userIds, instanceId: instanceId ?? undefined, isGroup: true })),
    )
    void qc.invalidateQueries({ queryKey: ['conversations'] })
    void qc.invalidateQueries({ queryKey: assignmentKeys.byInstance(instanceId ?? '_') })
    clearSelection()
    setSelectedAgentIds(new Set())
    const failed = results.filter((r) => r.status === 'rejected').length
    if (failed > 0) toast.error(`${failed} affectation(s) de groupe ont échoué.`)
  }

  // ── auto-assign config (per-instance) ─────────────────────────────────────
  // Two distinct commit paths:
  //   * Off/On toggle  → fires immediately (single click, no save needed)
  //   * Pool edit      → buffered as a draft inside the popover; Save commits
  // Re-syncs on instance switch or realtime UPDATE via key-reset pattern.
  const savedEnabled = activeInstance?.auto_assign_enabled ?? false
  const savedPool    = useMemo(() => {
    const set = new Set(agents.map((a) => a.id))
    return (activeInstance?.auto_assign_user_pool ?? []).filter((id) => set.has(id))
  }, [activeInstance?.auto_assign_user_pool, agents])

  const poolKey = `${instanceId ?? ''}|${[...savedPool].sort().join(',')}`
  const [poolDraftKey, setPoolDraftKey] = useState(poolKey)
  const [draftPool, setDraftPool] = useState<string[]>(savedPool)
  if (poolDraftKey !== poolKey) {
    setPoolDraftKey(poolKey)
    setDraftPool(savedPool)
  }

  const poolDirty =
    JSON.stringify([...draftPool].sort()) !== JSON.stringify([...savedPool].sort())

  function togglePoolMember(id: string) {
    setDraftPool((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
  }

  /** Toggle Off/On — commits immediately. Strategy is always round_robin.
   *
   * Off → On sequencing:
   *   1. Pool empty  → prompt to configure first
   *   2. Pool ready + unassigned DMs exist → prompt to apply backlog
   *   3. Otherwise → just turn on silently */
  async function commitEnabled(nextEnabled: boolean) {
    if (!instanceId) return
    try {
      await setAutoAssignMut.mutateAsync({
        instanceId,
        cfg: { enabled: nextEnabled, strategy: 'round_robin', pool: savedPool },
      })
      if (nextEnabled && !savedEnabled) {
        if (savedPool.length === 0) {
          setPoolEmptyPromptOpen(true)
        } else if (unassignedDmCount > 0) {
          setBacklogPromptOpen(true)
        }
      }
    } catch (e) { toast.error(normalizeError(e)) }
  }
  /** Save pool draft from the modal footer. If auto-assign is on AND there
   *  are existing unassigned DMs, prompt to apply backlog right after. */
  async function commitPool() {
    if (!instanceId) return
    try {
      await setAutoAssignMut.mutateAsync({
        instanceId,
        cfg: { enabled: savedEnabled, strategy: 'round_robin', pool: draftPool },
      })
      if (savedEnabled && draftPool.length > 0 && unassignedDmCount > 0) {
        setBacklogPromptOpen(true)
      }
    } catch (e) { toast.error(normalizeError(e)) }
  }
  function discardPoolDraft() {
    setDraftPool(savedPool)
  }

  const [configOpen, setConfigOpen] = useState(false)
  const [backlogPromptOpen, setBacklogPromptOpen] = useState(false)
  const [poolEmptyPromptOpen, setPoolEmptyPromptOpen] = useState(false)

  // Count of existing unassigned DMs for this instance — drives the smart
  // prompt that fires right after Off→On. React Compiler auto-memoizes this.
  let unassignedDmCount = 0
  for (const c of baseRows) {
    if (c.is_group) continue
    if ((assignmentsByConv.get(c.id ?? '')?.length ?? 0) === 0) unassignedDmCount += 1
  }

  async function applyBacklog() {
    if (!instanceId) return
    try {
      const count = await applyBacklogMut.mutateAsync(instanceId)
      // Realtime invalidation lags by up to a tick on bulk INSERTs; refetch
      // synchronously so the modal closes onto a UI that already reflects
      // the new assignment state (no need for the admin to refresh).
      await Promise.all([
        qc.refetchQueries({ queryKey: assignmentKeys.all }),
        qc.refetchQueries({ queryKey: ['conversations'] }),
      ])
      setBacklogPromptOpen(false)
      if (count === 0) {
        toast.info('Aucun DM assigné (pool vide ou aucun agent éligible).')
      } else {
        toast.success(`${count} conversation(s) assignée(s).`)
      }
    } catch (e) {
      toast.error(normalizeError(e))
    }
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <section className="page assignment-page">
      {/* IGF ADAPTATION: donor .page-hero masthead swapped for the IGF header
          used by every WhatsApp management page (Numbers pattern). */}
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.28em] text-ant-mid">
            <span className="h-1.5 w-1.5 rounded-full bg-ant-orange" />
            Admin · Acheminement
          </div>
          <h1 className="font-display text-[30px] md:text-[34px] leading-[1.05] tracking-[-0.02em] text-ant-ink">
            Affectation
          </h1>
          <p className="font-serif italic text-[14px] leading-relaxed text-ant-mid max-w-xl">
            Acheminez les conversations vers les agents. Action groupée possible. Les DM sont en 1:1, les groupes peuvent avoir plusieurs agents.
          </p>
        </div>
      </header>

      {/* Top bar: hero auto-assign card + instance pill */}
      <div className="assignment-topbar">
        <div className="assignment-topbar__row">
          <AutoAssignCard
            enabled={savedEnabled}
            poolCount={savedPool.length}
            agentTotal={agents.length}
            saving={setAutoAssignMut.isPending}
            onToggle={(next) => void commitEnabled(next)}
            onConfigure={() => setConfigOpen(true)}
          />
          {activeInstance && (
            <InstancePicker
              active={activeInstance}
              all={instances ?? []}
              onPick={(id) => setInstanceOverride(id)}
            />
          )}
        </div>
      </div>

      <AnimatePresence>
        {configOpen && activeInstance && (
          <AutoAssignModal
            key="auto-assign-modal"
            instance={activeInstance}
            agents={agents}
            savedEnabled={savedEnabled}
            savedPool={savedPool}
            draftPool={draftPool}
            poolDirty={poolDirty}
            saving={setAutoAssignMut.isPending}
            onClose={() => { if (poolDirty) discardPoolDraft(); setConfigOpen(false) }}
            onToggleEnabled={(next) => void commitEnabled(next)}
            onToggleAgent={togglePoolMember}
            onSetAll={(ids) => setDraftPool(ids)}
            onSave={async () => { await commitPool(); setConfigOpen(false) }}
            onDiscard={discardPoolDraft}
          />
        )}
      </AnimatePresence>

      {/* Smart prompts that fire when admin flips auto-assign On */}
      <AnimatePresence>
        {poolEmptyPromptOpen && (
          <PromptModal
            key="prompt-pool-empty"
            tone="warn"
            title="Le pool est vide"
            body={
              <>
                L'affectation auto est maintenant <strong>activée</strong> mais aucun agent n'est configuré.
                Choisissez les agents qui doivent recevoir les nouveaux DM.
              </>
            }
            primaryLabel="Configurer le pool"
            secondaryLabel="Plus tard"
            onPrimary={() => { setPoolEmptyPromptOpen(false); setConfigOpen(true) }}
            onClose={() => setPoolEmptyPromptOpen(false)}
          />
        )}
        {backlogPromptOpen && (
          <PromptModal
            key="prompt-backlog"
            tone="cta"
            title={`${unassignedDmCount} DM non assigné${unassignedDmCount === 1 ? '' : 's'}`}
            body={
              <>
                Appliquer l'affectation auto aux DM non assignés existants maintenant,
                ou n'acheminer que les nouveaux messages entrants à partir d'ici ?
              </>
            }
            primaryLabel={applyBacklogMut.isPending ? 'Affectation…' : `Appliquer aux ${unassignedDmCount} maintenant`}
            secondaryLabel="Nouveaux seulement"
            primaryDisabled={applyBacklogMut.isPending}
            onPrimary={applyBacklog}
            onClose={() => setBacklogPromptOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Two-pane body */}
      <div className="assignment-body">
        {/* LEFT: conversation pool */}
        <div className="assignment-pane">
          <div className="convpane__head">
            <div className="convpane__chips">
              {(Object.keys(CHIP_LABELS) as FilterChip[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={'convpane__chip' + (chip === k ? ' is-active' : '')}
                  onClick={() => setChip(k)}
                >
                  {CHIP_LABELS[k]}
                  <span className="convpane__chip-count">{chipCounts[k]}</span>
                </button>
              ))}
            </div>
            <input
              className="convpane__search"
              type="search"
              placeholder="Rechercher par nom, téléphone ou message…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="convpane__bulk">
              <button
                type="button"
                className="convpane__select-all"
                onClick={() => {
                  const allChecked = visibleRows.length > 0 && selectedIds.size === visibleRows.length
                  if (allChecked) clearSelection(); else selectAllVisible()
                }}
                aria-pressed={visibleRows.length > 0 && selectedIds.size === visibleRows.length}
              >
                <CheckSquare
                  state={
                    selectedIds.size === 0 ? 'off'
                    : selectedIds.size === visibleRows.length ? 'on'
                    : 'mixed'
                  }
                />
                <span>Tout sélectionner</span>
              </button>
              <span className={'convpane__bulk-count' + (selectedIds.size > 0 ? ' is-active' : '')}>
                {selectedIds.size}
                {selectionKind === 'dm'    && ' DM sélectionné' + (selectedIds.size === 1 ? '' : 's')}
                {selectionKind === 'group' && ' groupe' + (selectedIds.size === 1 ? '' : 's') + ' sélectionné' + (selectedIds.size === 1 ? '' : 's')}
                {selectionKind === null    && ' sélectionné'}
              </span>
              {selectedIds.size > 0 && (
                <button type="button" className="convpane__bulk-clear" onClick={clearSelection}>Effacer</button>
              )}
              {/* IGF ADDITION (donor gap): bulk unassign of the selection. */}
              {(() => {
                const withAssignees = Array.from(selectedIds).filter((id) => (assignmentsByConv.get(id) ?? []).length > 0).length
                return withAssignees > 0 ? (
                  <button
                    type="button"
                    className="convpane__bulk-clear convpane__bulk-unassign"
                    disabled={bulkUnassignMut.isPending}
                    onClick={() => void unassignSelected()}
                  >
                    Désassigner {withAssignees}
                  </button>
                ) : null
              })()}
            </div>
          </div>

          <ul className="convpane__list">
            {convs.isLoading && <li className="convpane__empty">Chargement…</li>}
            {!convs.isLoading && visibleRows.length === 0 && (
              <li className="convpane__empty">Aucune conversation ne correspond à ce filtre.</li>
            )}
            <AnimatePresence initial={false}>
              {visibleRows.map((c) => (
                <ConversationRow
                  key={c.id}
                  c={c}
                  assignees={assignmentsByConv.get(c.id!) ?? []}
                  profilesById={agents}
                  selected={!!c.id && selectedIds.has(c.id)}
                  onToggle={() => c.id && toggleSelected(c.id)}
                  onRemoveAssignee={(uid) => c.id && removeAssignee(c.id, uid)}
                />
              ))}
            </AnimatePresence>
          </ul>
        </div>

        {/* RIGHT: agent roster */}
        <div className="assignment-pane">
          <div className={'rosterpane__head' + (agentPickerActive ? ' is-picking' : '')}>
            <span className="rosterpane__title">Agents · {agents.length}</span>
            {agentPickerActive ? (
              <div className="rosterpane__head-actions">
                <button
                  type="button"
                  className="rosterpane__select-all"
                  onClick={() => {
                    const allChecked = agents.length > 0 && selectedAgentIds.size === agents.length
                    if (allChecked) setSelectedAgentIds(new Set())
                    else setSelectedAgentIds(new Set(agents.map((a) => a.id)))
                  }}
                  aria-pressed={agents.length > 0 && selectedAgentIds.size === agents.length}
                >
                  <CheckSquare
                    state={
                      selectedAgentIds.size === 0 ? 'off'
                      : selectedAgentIds.size === agents.length ? 'on'
                      : 'mixed'
                    }
                  />
                  <span>Tout sélectionner</span>
                </button>
                <button
                  type="button"
                  className="rosterpane__assign-btn"
                  disabled={selectedAgentIds.size === 0 || setAssignees.isPending}
                  onClick={() => assignSelectedGroupsToAgents(Array.from(selectedAgentIds))}
                >
                  Assigner à {selectedAgentIds.size}
                </button>
              </div>
            ) : (
              <span className="rosterpane__sub">cliquez pour assigner la sélection</span>
            )}
          </div>
          <ul className="rosterpane__list">
            {agents.length === 0 && (
              <li className="convpane__empty">Aucun utilisateur actif.</li>
            )}
            <AnimatePresence initial={false}>
              {agents.map((p) => {
                const openCount = openCountsByUser.get(p.id) ?? 0
                const isSelf = p.id === me?.id
                const ctaActive = selectedIds.size > 0
                const inPicker = agentPickerActive
                const isPicked = inPicker && selectedAgentIds.has(p.id)
                return (
                  <motion.li
                    key={p.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className={
                      'agentcard'
                      + (ctaActive && !inPicker ? ' is-droptarget' : '')
                      + (isPicked ? ' is-picked' : '')
                    }
                    onClick={inPicker ? () => toggleAgentSelected(p.id) : undefined}
                    role={inPicker ? 'button' : undefined}
                    aria-pressed={inPicker ? isPicked : undefined}
                    style={inPicker ? { cursor: 'pointer' } : undefined}
                  >
                    {inPicker && (
                      <span className="agentcard__check" aria-hidden>
                        <CheckSquare state={isPicked ? 'on' : 'off'} />
                      </span>
                    )}
                    <Avatar
                      config={p.avatar_config as AvatarConfig}
                      url={p.avatar_url ?? null}
                      size={44}
                      seed={p.email}
                      className="agentcard__avatar"
                    />
                    <div className="agentcard__meta">
                      <span className="agentcard__name">
                        {p.full_name || p.email}
                        {isSelf && <span className="agentcard__name-you">· vous</span>}
                      </span>
                      <span className="agentcard__stats">
                        <span className="agentcard__count" title="Conversations ouvertes">
                          <strong>{openCount}</strong> ouvertes
                        </span>
                        {p.role === 'admin' && <span className="badge badge--admin">Admin</span>}
                      </span>
                    </div>
                    {!inPicker && (
                      <button
                        type="button"
                        className={'agentcard__assign-btn' + (ctaActive ? ' is-cta' : '')}
                        disabled={!ctaActive || setAssignees.isPending || bulkAssignMut.isPending}
                        onClick={() => assignSelectedToUser(p.id)}
                      >
                        {ctaActive ? `Assigner ${selectedIds.size}` : 'Assigner'}
                      </button>
                    )}
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        </div>
      </div>

      {pendingUnassign && (
        <UnassignScheduledModal
          userName={pendingUnassign.name}
          count={pendingUnassign.ids.length}
          onCancel={() => setPendingUnassign(null)}
          onKeep={() => resolveUnassign(false)}
          onDrop={() => resolveUnassign(true)}
        />
      )}
      {pendingBulkUnassign && (
        <UnassignScheduledModal
          userName="La sélection"
          count={pendingBulkUnassign.smRows.length}
          contextLabel="pour ces conversations"
          onCancel={() => setPendingBulkUnassign(null)}
          onKeep={() => resolveBulkUnassign(false)}
          onDrop={() => resolveBulkUnassign(true)}
        />
      )}
    </section>
  )
}

// ─── conversation row ──────────────────────────────────────────────────────

function ConversationRow({
  c, assignees, profilesById, selected, onToggle, onRemoveAssignee,
}: {
  c: ConversationListRow
  assignees: string[]
  profilesById: { id: string; full_name: string | null; email: string; avatar_config: unknown; avatar_url?: string | null }[]
  selected: boolean
  onToggle: () => void
  onRemoveAssignee: (userId: string) => void
}) {
  const name = conversationLabel(c.remote_jid ?? '', c.peer_display_name, c.contact_book_name)
  const time = c.last_message_at ? relativeTime(c.last_message_at) : ''

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={'convrow' + (selected ? ' is-selected' : '')}
      onClick={onToggle}
      role="button"
      aria-pressed={selected}
    >
      <span className="convrow__check" aria-hidden>
        <CheckSquare state={selected ? 'on' : 'off'} />
      </span>
      {c.peer_profile_pic ? (
        <img src={c.peer_profile_pic} alt="" className="convrow__avatar" />
      ) : (
        <span
          className="convrow__avatar convrow__avatar--fallback"
          style={{ background: initialsColor(name) }}
          aria-hidden
        >
          {initialsOf(name)}
        </span>
      )}
      <div className="convrow__main">
        <div className="convrow__name-row">
          <span className="convrow__name">{name}</span>
          <span className={'badge ' + (c.is_group ? 'badge--active' : 'badge--inactive')}>
            {c.is_group ? 'GRP' : 'DM'}
          </span>
        </div>
        {assignees.length > 0 && (
          <div className="convrow__assignees">
            {assignees.map((uid) => {
              const p = profilesById.find((x) => x.id === uid)
              const label = p ? (p.full_name || p.email.split('@')[0]) : 'inconnu'
              return (
                <span key={uid} className="convrow__assignee-pill">
                  <Avatar
                    config={(p?.avatar_config as AvatarConfig) ?? null}
                    url={p?.avatar_url ?? null}
                    seed={p?.email ?? uid}
                    size={18}
                    className="convrow__assignee-pill-avatar"
                  />
                  <span className="convrow__assignee-pill-name">{label}</span>
                  <button
                    type="button"
                    className="convrow__assignee-pill-x"
                    aria-label={`Désassigner ${label}`}
                    onClick={(e) => { e.stopPropagation(); if (c.id) onRemoveAssignee(uid) }}
                  >×</button>
                </span>
              )
            })}
          </div>
        )}
      </div>
      <div className="convrow__time">{time}</div>
    </motion.li>
  )
}

// ─── shared small confirmation prompt ─────────────────────────────────────
// Compact branded modal used for one-shot decisions (pool-empty warning,
// backlog apply). Uses the same scrim + entry as AutoAssignModal but a
// narrower card with two actions.

function PromptModal({
  tone, title, body, primaryLabel, secondaryLabel,
  primaryDisabled, onPrimary, onClose,
}: {
  tone: 'cta' | 'warn'
  title: string
  body: React.ReactNode
  primaryLabel: string
  secondaryLabel: string
  primaryDisabled?: boolean
  onPrimary: () => void | Promise<void>
  onClose: () => void
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      className="aamodal-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        className={'promptmodal promptmodal--' + tone}
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="dialog"
        aria-modal="true"
      >
        <div className="promptmodal__glyph" aria-hidden>
          {tone === 'warn' ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <h3 className="promptmodal__title">{title}</h3>
        <p className="promptmodal__body">{body}</p>
        <div className="promptmodal__actions">
          <button type="button" className="aamodal__btn aamodal__btn--ghost" onClick={onClose}>
            {secondaryLabel}
          </button>
          <button
            type="button"
            className="aamodal__btn aamodal__btn--cta"
            disabled={primaryDisabled}
            onClick={() => void onPrimary()}
          >
            {primaryLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ─── auto-assign hero card (topbar) ───────────────────────────────────────
// Single prominent control that surfaces the auto-assign state at a glance:
// status pill (Off | On + agent count), Off/On quick toggle, and a
// "Configure" CTA that opens the full modal. This is the headline feature of
// the routing page — it deserves visual weight.

function AutoAssignCard({
  enabled, poolCount, agentTotal, saving, onToggle, onConfigure,
}: {
  enabled: boolean
  poolCount: number
  agentTotal: number
  saving: boolean
  onToggle: (next: boolean) => void
  onConfigure: () => void
}) {
  const noPool = enabled && poolCount === 0
  return (
    <div className={'aacard' + (enabled ? ' is-on' : '')}>
      <div className="aacard__glyph" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="aacard__meta">
        <span className="aacard__eyebrow">Affectation auto des nouveaux DM</span>
        <span className="aacard__status">
          {enabled ? (
            <>
              <span className="aacard__dot" aria-hidden />
              <strong>Activée</strong>
              <span className="aacard__sep">·</span>
              {noPool ? (
                <span className="aacard__warn">aucun agent dans le pool</span>
              ) : (
                <>acheminement vers <strong>{poolCount}</strong> agent{poolCount === 1 ? '' : 's'} sur {agentTotal}</>
              )}
            </>
          ) : (
            <>
              <span className="aacard__dot aacard__dot--off" aria-hidden />
              Désactivée — chaque nouveau DM reste non assigné
            </>
          )}
        </span>
      </div>
      <div className="aacard__actions">
        <button
          type="button"
          className="aacard__toggle"
          role="switch"
          aria-checked={enabled}
          disabled={saving}
          onClick={() => onToggle(!enabled)}
        >
          <span className="aacard__toggle-track">
            <span className="aacard__toggle-thumb" />
          </span>
          <span className="aacard__toggle-label">{enabled ? 'Activée' : 'Désactivée'}</span>
        </button>
        <button type="button" className="aacard__configure" onClick={onConfigure}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.7" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Configurer
        </button>
      </div>
    </div>
  )
}

// ─── auto-assign modal ────────────────────────────────────────────────────
// Full-screen scrim + centered dialog. Two sections inside: instance picker
// (when >1 instance exists; otherwise read-only header) and the agent pool
// with select-all + per-agent checkbox rows. Sticky footer with Cancel/Save.

interface PoolAgent {
  id: string
  full_name: string | null
  email: string
  avatar_config: unknown
  avatar_url?: string | null
}

function AutoAssignModal({
  instance, agents,
  savedEnabled, savedPool, draftPool, poolDirty, saving,
  onClose, onToggleEnabled, onToggleAgent, onSetAll,
  onSave, onDiscard,
}: {
  instance: WhatsappInstance
  agents: PoolAgent[]
  savedEnabled: boolean
  savedPool: string[]
  draftPool: string[]
  poolDirty: boolean
  saving: boolean
  onClose: () => void
  onToggleEnabled: (next: boolean) => void
  onToggleAgent: (id: string) => void
  onSetAll: (ids: string[]) => void
  onSave: () => void | Promise<void>
  onDiscard: () => void
}) {
  // Close on Escape (always — Cancel/Save in footer handle dirty intent).
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const allSelected  = agents.length > 0 && draftPool.length === agents.length
  const someSelected = draftPool.length > 0 && !allSelected
  const noSelection  = draftPool.length === 0

  return (
    <motion.div
      className="aamodal-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.2 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <motion.div
        className="aamodal"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="aamodal-title"
      >
        <header className="aamodal__head">
          <div>
            <span className="aamodal__eyebrow">Acheminement</span>
            <h2 id="aamodal-title" className="aamodal__title">Configurer l'affectation auto</h2>
            <span className="aamodal__head-sub">
              pour <strong>{instance.display_name || instance.phone_number || 'Sans nom'}</strong>
            </span>
          </div>
        </header>

        <div className="aamodal__body">
          {/* Master toggle */}
          <section className="aamodal__section">
            <div className="aamodal__row">
              <div className="aamodal__row-meta">
                <span className="aamodal__row-label">Affectation auto des nouveaux DM</span>
                <span className="aamodal__row-hint">
                  Achemine les DM entrants vers le pool ci-dessous à tour de rôle.
                </span>
              </div>
              <button
                type="button"
                className="aacard__toggle aacard__toggle--lg"
                role="switch"
                aria-checked={savedEnabled}
                disabled={saving}
                onClick={() => onToggleEnabled(!savedEnabled)}
              >
                <span className="aacard__toggle-track">
                  <span className="aacard__toggle-thumb" />
                </span>
                <span className="aacard__toggle-label">{savedEnabled ? 'Activée' : 'Désactivée'}</span>
              </button>
            </div>
          </section>

          {/* Pool section */}
          <section className="aamodal__section">
            <div className="aamodal__section-head">
              <span className="aamodal__section-title">Pool · {draftPool.length} sur {agents.length}</span>
              <button
                type="button"
                className="aamodal__select-all"
                onClick={() => onSetAll(allSelected ? [] : agents.map((a) => a.id))}
                aria-pressed={allSelected}
              >
                <CheckSquare state={allSelected ? 'on' : someSelected ? 'mixed' : 'off'} />
                <span>Tout sélectionner</span>
              </button>
            </div>
            {agents.length === 0 ? (
              <div className="aamodal__empty">Aucun utilisateur actif à ajouter au pool.</div>
            ) : (
              <ul className="aamodal__pool-list">
                {agents.map((p) => {
                  const inPool = draftPool.includes(p.id)
                  return (
                    <li
                      key={p.id}
                      className={'aamodal__pool-row' + (inPool ? ' is-picked' : '')}
                      onClick={() => onToggleAgent(p.id)}
                      role="option"
                      aria-selected={inPool}
                    >
                      <span className="aamodal__pool-check" aria-hidden>
                        <CheckSquare state={inPool ? 'on' : 'off'} />
                      </span>
                      <Avatar
                        config={(p.avatar_config as AvatarConfig) ?? null}
                        url={p.avatar_url ?? null}
                        seed={p.email}
                        size={36}
                      />
                      <div className="aamodal__pool-meta">
                        <span className="aamodal__pool-name">{p.full_name || p.email}</span>
                        <span className="aamodal__pool-sub">{p.email}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {savedEnabled && noSelection && (
              <div className="aamodal__warn">
                L'affectation auto est activée mais aucun agent n'est dans le pool — les DM entrants resteront non assignés.
              </div>
            )}
          </section>
        </div>

        <footer className="aamodal__foot">
          <span className="aamodal__foot-stat">
            {poolDirty
              ? <><span className="aamodal__dot" /> Modifications non enregistrées</>
              : savedPool.length > 0
                ? <>{savedPool.length} agent{savedPool.length === 1 ? '' : 's'} dans le pool</>
                : 'Le pool est vide'}
          </span>
          <div className="aamodal__foot-actions">
            <button
              type="button"
              className="aamodal__btn aamodal__btn--ghost"
              onClick={() => {
                if (poolDirty) onDiscard()
                onClose()
              }}
            >
              {poolDirty ? 'Annuler' : 'Fermer'}
            </button>
            <button
              type="button"
              className="aamodal__btn aamodal__btn--cta"
              disabled={!poolDirty || saving}
              onClick={onSave}
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  )
}

// ─── instance picker ──────────────────────────────────────────────────────
// Shows the active instance's avatar + display name + WhatsApp profile name
// at all times. With multiple instances, opens a dropdown listing each plus
// a "Select all" pseudo-option (currently disabled — multi-instance routing
// view requires schema work to aggregate per-instance pools/configs).

function InstancePicker({
  active, all, onPick,
}: {
  active: WhatsappInstance
  all: WhatsappInstance[]
  onPick: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const multi = all.length > 1

  return (
    <div className="instance-picker" ref={ref}>
      <button
        type="button"
        className={'instance-picker__trigger' + (multi ? ' is-clickable' : '')}
        disabled={!multi}
        onClick={() => multi && setOpen((v) => !v)}
        aria-haspopup={multi ? 'listbox' : undefined}
        aria-expanded={multi ? open : undefined}
      >
        <InstanceAvatar inst={active} />
        <span className="instance-picker__labels">
          <span className="instance-picker__name">{active.display_name || active.phone_number || 'Sans nom'}</span>
          {active.wa_profile_name && (
            <span className="instance-picker__wa">{active.wa_profile_name}</span>
          )}
        </span>
        {multi && (
          <svg className={'instance-picker__chevron' + (open ? ' is-open' : '')} width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <path d="M3 5.5 7 9.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <AnimatePresence>
        {open && multi && (
          <motion.div
            className="instance-picker__pop"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            role="listbox"
          >
            {all.map((i) => {
              const isActive = i.id === active.id
              return (
                <button
                  key={i.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={'instance-picker__opt' + (isActive ? ' is-active' : '')}
                  onClick={() => { onPick(i.id); setOpen(false) }}
                >
                  <InstanceAvatar inst={i} />
                  <span className="instance-picker__labels">
                    <span className="instance-picker__name">{i.display_name || i.phone_number || 'Sans nom'}</span>
                    {i.wa_profile_name && <span className="instance-picker__wa">{i.wa_profile_name}</span>}
                  </span>
                  {isActive && (
                    <svg className="instance-picker__tick" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                      <path d="M2.5 7.5 5.5 10.5 11.5 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function InstanceAvatar({ inst }: { inst: WhatsappInstance }) {
  if (inst.profile_pic_url) {
    return <img src={inst.profile_pic_url} alt="" className="instance-picker__pic" />
  }
  const seed = inst.display_name || inst.phone_number || inst.id
  return (
    <span className="instance-picker__pic instance-picker__pic--fallback" style={{ background: initialsColor(seed) }} aria-hidden>
      {initialsOf(inst.display_name || inst.phone_number || 'WA')}
    </span>
  )
}

// ─── custom checkbox (SVG, no native control) ─────────────────────────────

function CheckSquare({ state }: { state: 'on' | 'off' | 'mixed' }) {
  const filled = state !== 'off'
  return (
    <span className={'check-square' + (filled ? ' is-on' : '')} data-state={state}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <rect
          x="1.5" y="1.5" width="15" height="15" rx="4"
          className="check-square__box"
        />
        {state === 'on' && (
          <path
            d="M5 9.2 7.7 11.8 13 6.5"
            fill="none"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="check-square__tick"
          />
        )}
        {state === 'mixed' && (
          <path
            d="M5.2 9 12.8 9"
            fill="none"
            strokeWidth="1.9"
            strokeLinecap="round"
            className="check-square__tick"
          />
        )}
      </svg>
    </span>
  )
}

// ─── tiny utils local to this page ─────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'à l\'instant'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`
  return `${Math.round(ms / 86_400_000)} j`
}

// Initials fallback rotates through the Anthropic brand accent palette so a
// missing profile pic still reads as the SAME person across the app (color
// derived deterministically from name).
const INITIALS_PALETTE = ['#d97757', '#6a9bcc', '#788c5d', '#b0aea5'] as const

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
function initialsColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return INITIALS_PALETTE[h % INITIALS_PALETTE.length]
}
