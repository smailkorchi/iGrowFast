// Shared active-instance state for the agent (role=user) shell.
//
// The navbar (UserLayout) and the inbox page (/user/whatsapp) are sibling
// routes that both need the SAME notion of "which assigned number is active":
//   * the navbar highlights the open instance + writes the selection on click;
//   * the inbox page renders that instance's conversations.
//
// Lifting it here makes one source of truth. `useInstances()` is already
// RLS-scoped to the instances the agent has an assigned conversation on
// (wi_select policy), so an agent with zero assignments gets an empty list and
// the navbar shows no WhatsApp entries at all.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useInstances } from '../queries/instances'
import { useInstancesUnread, useInstancesUnreadRealtime } from '../queries/conversations'
import { useMyAssignmentsRealtime } from '../queries/assignments'
import { useAuth } from '../auth'
import type { WhatsappInstance } from '../database.types'

const ACTIVE_INSTANCE_KEY = 'wam.cv.user.active_instance'

interface ActiveInstanceValue {
  instances: WhatsappInstance[] | undefined
  instancesLoading: boolean
  activeInstanceId: string | null
  switchInstance: (id: string) => void
  unreadByInstance: Map<string, number> | undefined
}

const Ctx = createContext<ActiveInstanceValue | null>(null)

export function useActiveInstance(): ActiveInstanceValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useActiveInstance must be used within <ActiveInstanceProvider>')
  return v
}

export function ActiveInstanceProvider({ children }: { children: ReactNode }) {
  const { data: instances, isLoading: instancesLoading } = useInstances()

  // ALWAYS-ON per-agent assignment sync — mounted here (the seller shell is
  // always present, even at the empty state) so a newly-granted assignment
  // makes a number appear live, and losing the last assignment drops to the
  // empty state live, without a refresh. Keyed on the agent's own user id.
  const { session } = useAuth()
  useMyAssignmentsRealtime(session?.user.id ?? null)

  // User-picked active instance survives a reload. Namespaced separately from
  // admin so a browser session that toggles roles doesn't cross-pollute.
  const [pickedInstanceId, setPickedInstanceId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_INSTANCE_KEY) } catch { return null }
  })

  const activeInstanceId = useMemo(() => {
    if (!instances || instances.length === 0) return null
    if (pickedInstanceId && instances.some((i) => i.id === pickedInstanceId)) return pickedInstanceId
    const connected = instances.find((i) => i.status === 'connected')
    return (connected ?? instances[0])?.id ?? null
  }, [instances, pickedInstanceId])

  const switchInstance = useCallback((id: string) => {
    setPickedInstanceId(id)
    try { localStorage.setItem(ACTIVE_INSTANCE_KEY, id) } catch { /* noop */ }
  }, [])

  const instanceIds = useMemo(() => (instances ?? []).map((i) => i.id), [instances])
  const { data: unreadByInstance } = useInstancesUnread(instanceIds)
  // Realtime per-instance unread so the agent navbar badge is instant.
  useInstancesUnreadRealtime()

  const value = useMemo<ActiveInstanceValue>(
    () => ({ instances, instancesLoading, activeInstanceId, switchInstance, unreadByInstance }),
    [instances, instancesLoading, activeInstanceId, switchInstance, unreadByInstance],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
