import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'

export interface Contact {
  id: string
  instance_id: string
  phone_number: string | null
  phone_jid: string | null
  lid: string | null
  book_name: string | null
  push_name: string | null
  profile_pic: string | null
  is_resolved: boolean
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export const contactKeys = {
  all: ['contacts'] as const,
  list: (instanceId: string) => ['contacts', 'list', instanceId] as const,
  unresolved: (instanceId: string) => ['contacts', 'unresolved', instanceId] as const,
  bookMap: (instanceId: string) => ['contacts', 'bookMap', instanceId] as const,
}

export function useContactBookMap(instanceId: string | null) {
  return useQuery<Map<string, string>>({
    queryKey: contactKeys.bookMap(instanceId ?? '_'),
    queryFn: async () => {
      if (!instanceId) return new Map()
      const { data, error } = await supabase
        .schema('whatsapp').from('contacts')
        .select('phone_jid, lid, book_name')
        .eq('instance_id', instanceId)
        .not('book_name', 'is', null)
      if (error) throw new Error(error.message)
      const m = new Map<string, string>()
      for (const row of data ?? []) {
        if (!row.book_name) continue
        if (row.phone_jid) m.set(row.phone_jid, row.book_name)
        if (row.lid) m.set(row.lid, row.book_name)
      }
      return m
    },
    enabled: !!instanceId,
    staleTime: 60 * 1000,
  })
}

export function useContacts(instanceId: string | null) {
  return useQuery<Contact[]>({
    queryKey: contactKeys.list(instanceId ?? '_'),
    queryFn: async () => {
      if (!instanceId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('contacts')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('is_resolved', true)
        .order('updated_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as Contact[]
    },
    enabled: !!instanceId,
  })
}

export function useUnresolvedContacts(instanceId: string | null) {
  return useQuery<Contact[]>({
    queryKey: contactKeys.unresolved(instanceId ?? '_'),
    queryFn: async () => {
      if (!instanceId) return []
      const { data, error } = await supabase
        .schema('whatsapp').from('contacts')
        .select('*')
        .eq('instance_id', instanceId)
        .eq('is_resolved', false)
        .order('updated_at', { ascending: false })
      if (error) throw new Error(error.message)
      return (data ?? []) as Contact[]
    },
    enabled: !!instanceId,
  })
}

export function useUpsertContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      id?: string
      instanceId: string
      phoneNumber: string
      bookName: string | null
    }) => {
      if (params.id) {
        const { error } = await supabase
          .schema('whatsapp').from('contacts')
          .update({
            phone_number: params.phoneNumber,
            phone_jid: params.phoneNumber + '@s.whatsapp.net',
            book_name: params.bookName,
            updated_at: new Date().toISOString(),
          })
          .eq('id', params.id)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase.schema('whatsapp').rpc('import_phone_book_entry', {
          p_instance_id: params.instanceId,
          p_phone_number: params.phoneNumber,
          p_book_name: params.bookName ?? '',
        })
        if (error) throw new Error(error.message)
      }
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: contactKeys.list(v.instanceId) })
      void qc.invalidateQueries({ queryKey: contactKeys.unresolved(v.instanceId) })
    },
  })
}

export function useDeleteContacts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: { ids: string[]; instanceId: string }) => {
      const { error } = await supabase
        .schema('whatsapp').from('contacts')
        .delete()
        .in('id', params.ids)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: contactKeys.list(v.instanceId) })
      void qc.invalidateQueries({ queryKey: contactKeys.unresolved(v.instanceId) })
    },
  })
}

// Manually map a pending LID-only contact onto an existing resolved contact.
// The unique constraints we must clear before the RPCs can succeed:
//   contacts        (instance_id, lid)        — held by the pending row
//   jid_mapping     (instance_id, lid)        — possibly held by a stale auto-discovered mapping
//   jid_mapping     (instance_id, phone_jid)  — possibly held by another LID claiming the same phone
// Manual map overrides any prior auto-discovered mapping, so we wipe both
// jid_mapping slots before re-inserting via upsert_jid_mapping, then run
// resolve_contact_from_mapping (which takes phone_jid as a param and attaches
// lid + COALESCE push_name/profile_pic onto the resolved phone-JID contact).
export function useResolveContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      instanceId: string
      lid: string
      phoneJid: string
      pendingContactId: string
      pushName?: string | null
      profilePic?: string | null
    }) => {
      const { error: delContactErr } = await supabase
        .schema('whatsapp').from('contacts')
        .delete()
        .eq('id', params.pendingContactId)
      if (delContactErr) throw new Error(delContactErr.message)

      // Clear conflicting jid_mapping rows. Two separate deletes (no .or()
      // because PostgREST .or() with literal JIDs needs quoting that's easy to
      // get wrong). Errors here are non-fatal — if RLS blocks delete we'll
      // still try the upsert below and fall through to the resolve step.
      await supabase
        .schema('whatsapp').from('jid_mapping')
        .delete()
        .eq('instance_id', params.instanceId)
        .eq('phone_jid', params.phoneJid)
      await supabase
        .schema('whatsapp').from('jid_mapping')
        .delete()
        .eq('instance_id', params.instanceId)
        .eq('lid', params.lid)

      const { error: mapErr } = await supabase.schema('whatsapp').rpc('upsert_jid_mapping', {
        p_instance_id: params.instanceId,
        p_lid: params.lid,
        p_phone_jid: params.phoneJid,
        p_source: 'manual_map',
      })
      // Best-effort: mapping is for future webhook auto-resolution. If RLS or
      // a residual unique conflict blocks it, the user-visible resolve below
      // is still what marks the contact resolved.
      if (mapErr) console.warn('manual map: jid_mapping insert failed', mapErr.message)

      const { error: resolveErr } = await supabase.schema('whatsapp').rpc('resolve_contact_from_mapping', {
        p_instance_id: params.instanceId,
        p_lid: params.lid,
        p_phone_jid: params.phoneJid,
        p_push_name: params.pushName ?? undefined,
        p_profile_pic: params.profilePic ?? undefined,
      })
      if (resolveErr) throw new Error(resolveErr.message)
    },
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: contactKeys.list(v.instanceId) })
      void qc.invalidateQueries({ queryKey: contactKeys.unresolved(v.instanceId) })
      void qc.invalidateQueries({ queryKey: contactKeys.bookMap(v.instanceId) })
    },
  })
}

interface PhoneBookEntry {
  name: string
  phone: string
}

function parseVcf(text: string): PhoneBookEntry[] {
  const entries: PhoneBookEntry[] = []
  const cards = text.split('BEGIN:VCARD')
  for (const card of cards) {
    if (!card.trim()) continue
    const fnMatch = card.match(/FN[^:]*:([^\r\n]+)/)
    const telMatch = card.match(/TEL[^:]*:([^\r\n]+)/)
    if (telMatch) {
      const phone = telMatch[1].replace(/[^0-9+]/g, '')
      const name = fnMatch?.[1]?.trim() ?? ''
      if (phone) entries.push({ name, phone })
    }
  }
  return entries
}

function parseCsv(text: string): PhoneBookEntry[] {
  const entries: PhoneBookEntry[] = []
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return entries
  const header = lines[0].toLowerCase()
  const cols = header.split(/[,;\t]/)
  const nameIdx = cols.findIndex((c) => c.includes('name') || c.includes('nom'))
  const phoneIdx = cols.findIndex((c) => c.includes('phone') || c.includes('tel') || c.includes('number'))
  if (phoneIdx === -1) return entries
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/[,;\t]/)
    const phone = parts[phoneIdx]?.replace(/[^0-9+]/g, '') ?? ''
    const name = nameIdx >= 0 ? parts[nameIdx]?.trim() ?? '' : ''
    if (phone.length >= 7) entries.push({ name, phone })
  }
  return entries
}

function normalizePhone(raw: string, countryCode: string): string {
  let phone = raw.replace(/[^0-9]/g, '')
  if (phone.startsWith('00')) phone = phone.slice(2)
  if (phone.startsWith('0')) phone = countryCode + phone.slice(1)
  return phone
}

export function useUploadPhoneBook(onProgress?: (imported: number, total: number) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ instanceId, file, countryCode }: { instanceId: string; file: File; countryCode: string }) => {
      const text = await file.text()
      const isVcf = file.name.toLowerCase().endsWith('.vcf')
      const entries = isVcf ? parseVcf(text) : parseCsv(text)
      if (entries.length === 0) throw new Error('Aucun contact trouvé dans le fichier.')

      // Deduplicate by phone number (VCF files often have duplicate entries)
      const deduped = new Map<string, string | null>()
      for (const e of entries) {
        const phone = normalizePhone(e.phone, countryCode)
        if (phone.length >= 7 && !deduped.has(phone)) {
          deduped.set(phone, e.name || null)
        }
      }
      const normalized = Array.from(deduped, ([phone, name]) => ({ phone, name }))
      onProgress?.(0, normalized.length)

      const CONCURRENCY = 10
      let imported = 0
      for (let i = 0; i < normalized.length; i += CONCURRENCY) {
        const chunk = normalized.slice(i, i + CONCURRENCY)
        const results = await Promise.all(
          chunk.map((e) =>
            supabase.schema('whatsapp').rpc('import_phone_book_entry', {
              p_instance_id: instanceId,
              p_phone_number: e.phone,
              p_book_name: e.name ?? '',
            })
          )
        )
        for (const r of results) {
          if (r.error) throw new Error(r.error.message)
        }
        imported += chunk.length
        onProgress?.(imported, normalized.length)
      }
      return { imported, total: normalized.length }
    },
    onSuccess: (_data, { instanceId }) => {
      void qc.invalidateQueries({ queryKey: contactKeys.list(instanceId) })
      void qc.invalidateQueries({ queryKey: contactKeys.unresolved(instanceId) })
    },
  })
}
