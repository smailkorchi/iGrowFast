// Optimistic group system-event pills.
//
// When the dashboard performs a group action (create / add / remove / leave /
// promote / demote), the WhatsApp→Evolution→webhook round-trip is not instant.
// To make the action appear in the thread immediately — exactly like the real
// WhatsApp client — the edge fn writes the pill itself via the service-role
// RPC `append_group_system_event` right after the Evolution call succeeds.
//
// The worker's stub-ingest later receives the echo and computes the SAME
// deterministic dedup key (+ a 5-min existence guard keyed on event/actor/
// targets), so it no-ops — no duplicate pill. The actor is always the owner
// ("Vous") here, since these are dashboard-initiated actions.

import { admin } from './admin.ts'

const onlyDigits = (s: string | null | undefined): string =>
  String(s ?? '').replace(/@.*$/, '').replace(/[^0-9]/g, '')

type GroupEvent = 'create' | 'add' | 'remove' | 'promote' | 'demote' | 'leave' | 'subject' | 'icon' | 'icon_remove'

// French copy for the owner's own action (actor = "Vous").
function buildSelfBody(event: GroupEvent, targets: string[], newSubject: string | null): string {
  const list = targets.length ? targets.join(', ') : 'un membre'
  switch (event) {
    case 'create':  return 'Vous avez créé ce groupe'
    case 'add':     return `Vous avez ajouté ${list}`
    case 'remove':  return `Vous avez retiré ${list}`
    case 'promote': return `Vous avez nommé ${list} administrateur`
    case 'demote':  return `Vous avez retiré ${list} des administrateurs`
    case 'leave':   return 'Vous avez quitté le groupe'
    case 'subject': return newSubject ? `Vous avez modifié le nom du groupe en « ${newSubject} »` : 'Vous avez modifié le nom du groupe'
    case 'icon':    return 'Vous avez modifié l’icône du groupe'
    case 'icon_remove': return 'Vous avez supprimé l’icône du groupe'
    default:        return 'Vous avez mis à jour le groupe'
  }
}

// Resolve target digits → best display name (book > push > group push),
// fallback to +digits. Mirrors the worker so optimistic + echo bodies match.
async function resolveNames(
  instanceId: string,
  groupJid: string,
  participantDigits: string[],
): Promise<string[]> {
  const wanted = [...new Set(participantDigits.filter((d) => d.length >= 5))]
  if (!wanted.length) return participantDigits.map((d) => `+${d}`)
  const names = new Map<string, string>()
  try {
    const { data: contacts } = await admin
      .schema('whatsapp')
      .from('contacts')
      .select('phone_jid, push_name, book_name')
      .eq('instance_id', instanceId)
    for (const c of (contacts ?? []) as Array<{ phone_jid: string | null; push_name: string | null; book_name: string | null }>) {
      const d = onlyDigits(c.phone_jid)
      const name = c.book_name || c.push_name
      if (d && name && !names.has(d)) names.set(d, name)
    }
    const { data: parts } = await admin
      .schema('whatsapp')
      .from('group_participants')
      .select('participant_jid, phone_jid, push_name')
      .eq('instance_id', instanceId)
      .eq('group_jid', groupJid)
    for (const p of (parts ?? []) as Array<{ participant_jid: string | null; phone_jid: string | null; push_name: string | null }>) {
      const d = onlyDigits(p.phone_jid || p.participant_jid)
      if (d && p.push_name && !names.has(d)) names.set(d, p.push_name)
    }
  } catch { /* preview-only */ }
  return participantDigits.map((d) => names.get(d) ?? `+${d}`)
}

/**
 * Write an optimistic group-event pill for a dashboard-initiated action.
 * Non-fatal: any failure (e.g. the conversation row not materialized yet for a
 * brand-new group) is swallowed — the worker stub-ingest is the backstop.
 */
export async function appendOwnGroupEvent(
  instanceId: string,
  groupJid: string,
  event: GroupEvent,
  participants: string[],          // bare digits or JIDs of the affected members
  newSubject: string | null = null,
): Promise<void> {
  try {
    // Owner is the actor; align actor_jid digits with the worker echo for dedup.
    const { data: inst } = await admin
      .schema('whatsapp')
      .from('whatsapp_instances')
      .select('wa_owner_jid')
      .eq('id', instanceId)
      .maybeSingle()
    const ownerJid = (inst as { wa_owner_jid?: string } | null)?.wa_owner_jid ?? null

    const targetDigits = participants.map(onlyDigits).filter(Boolean)
    // A leave has no separate target (the actor IS the leaver). Keep target_jids
    // empty so it dedups against the worker's reclassified self-leave pill.
    const targetJids = event === 'leave' ? [] : targetDigits
    const targetNames = event === 'leave' ? [] : await resolveNames(instanceId, groupJid, targetDigits)

    const body = buildSelfBody(event, targetNames, newSubject)
    const mediaMeta: Record<string, unknown> = {
      subtype: 'group_event',
      event,
      actor_jid: ownerJid,
      target_jids: targetJids,
    }
    if (newSubject) mediaMeta.new_subject = newSubject

    await admin.schema('whatsapp').rpc('append_group_system_event', {
      p_instance_id: instanceId,
      p_remote_jid: groupJid,
      p_body: body,
      p_media_meta: mediaMeta,
    })
  } catch (_err) {
    // best-effort; worker stub-ingest will write it if this lost the race
  }
}
