// One-shot backfill: replace stale (expiring) WhatsApp CDN profile-picture
// URLs already sitting in the DB with stable R2-cached URLs.
//
// Why a re-fetch is required: the stored pps.whatsapp.net URLs are themselves
// expired — we cannot download bytes from them. The only way to heal an
// existing row is to ask Evolution for a *fresh* signed URL, cache its bytes
// to R2, then overwrite the stale URL with the stable one.
//
// Scope: DM/contact avatars (contacts, contact_profiles, conversations DM
// rows). Group pictures self-heal through the hourly findGroupInfos refresh.
//
// Run (on the worker host, after `npm run build`):
//   node dist/scripts/backfill-avatars.js [instanceId]
// or in dev:
//   npx tsx src/scripts/backfill-avatars.ts [instanceId]
//
// Idempotent: rows already pointing at a cached avatar are skipped; cacheAvatar
// itself HEAD-checks R2 before any download.

import { pool } from '../db.js'
import { config } from '../config.js'
import { log } from '../logger.js'
import { cacheAvatar, isCachedAvatar } from '../r2/avatar.js'

const CONCURRENCY = 5
const onlyInstance = process.argv[2] ?? null

interface InstanceRow {
  id: string
  evolution_instance_name: string
}

interface Candidate {
  jid: string
  /** Best number to look up with (phone digits if we have them, else the JID local-part). */
  lookupNumber: string
}

async function listInstances(): Promise<InstanceRow[]> {
  const { rows } = await pool.query<InstanceRow>(
    `SELECT id, evolution_instance_name
       FROM public.whatsapp_instances
      WHERE status = 'connected'
        AND evolution_instance_name IS NOT NULL
        ${onlyInstance ? 'AND id = $1' : ''}`,
    onlyInstance ? [onlyInstance] : [],
  )
  return rows
}

// Gather every DM/contact JID for an instance whose avatar is missing or stale.
async function listCandidates(instanceId: string): Promise<Candidate[]> {
  const { rows } = await pool.query<{ jid: string; profile_pic: string | null }>(
    `SELECT jid, profile_pic FROM (
        SELECT phone_jid AS jid, profile_pic
          FROM public.contacts
         WHERE instance_id = $1 AND phone_jid IS NOT NULL
       UNION
        SELECT lid AS jid, profile_pic
          FROM public.contacts
         WHERE instance_id = $1 AND lid IS NOT NULL AND phone_jid IS NULL
       UNION
        SELECT remote_jid AS jid, peer_profile_pic AS profile_pic
          FROM public.conversations
         WHERE instance_id = $1 AND remote_jid LIKE '%@s.whatsapp.net'
       UNION
        SELECT jid, profile_pic
          FROM public.contact_profiles
         WHERE instance_id = $1
     ) u`,
    [instanceId],
  )

  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of rows) {
    const jid = r.jid
    if (!jid || jid.endsWith('@g.us')) continue
    if (isCachedAvatar(r.profile_pic)) continue // already healed
    if (seen.has(jid)) continue
    seen.add(jid)
    const lookupNumber = jid.replace('@s.whatsapp.net', '').replace('@lid', '')
    out.push({ jid, lookupNumber })
  }
  return out
}

// Write the freshly-cached avatar URL across all three tables for one JID.
async function persist(instanceId: string, jid: string, url: string): Promise<void> {
  await pool.query(
    `UPDATE public.contacts SET profile_pic = $3, updated_at = now()
      WHERE instance_id = $1 AND (phone_jid = $2 OR lid = $2)
        AND profile_pic IS DISTINCT FROM $3`,
    [instanceId, jid, url],
  )
  await pool.query(
    `UPDATE public.conversations SET peer_profile_pic = $3
      WHERE instance_id = $1 AND remote_jid = $2
        AND peer_profile_pic IS DISTINCT FROM $3`,
    [instanceId, jid, url],
  )
  await pool.query(
    `SELECT public.upsert_contact_profile($1, $2, NULL, $3)`,
    [instanceId, jid, url],
  )
}

async function backfillInstance(inst: InstanceRow): Promise<{ healed: number; missed: number }> {
  const base = config.evolutionApiUrl.replace(/\/$/, '')
  const candidates = await listCandidates(inst.id)
  log.info('backfill.instance.start', { instance_id: inst.id, candidates: candidates.length })

  let healed = 0
  let missed = 0

  const one = async (c: Candidate): Promise<void> => {
    try {
      const url = `${base}/chat/fetchProfilePictureUrl/${encodeURIComponent(inst.evolution_instance_name)}?number=${encodeURIComponent(c.lookupNumber)}`
      const res = await fetch(url, {
        headers: { apikey: config.evolutionGlobalApiKey },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) { missed++; return }
      const j = await res.json() as { profilePictureUrl?: string | null; url?: string | null }
      const cached = await cacheAvatar(inst.id, j.profilePictureUrl ?? j.url)
      if (!cached) { missed++; return }
      await persist(inst.id, c.jid, cached)
      healed++
    } catch {
      missed++
    }
  }

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    await Promise.allSettled(candidates.slice(i, i + CONCURRENCY).map(one))
    if (i > 0 && i % 50 === 0) log.info('backfill.progress', { instance_id: inst.id, done: i, healed, missed })
  }

  log.info('backfill.instance.done', { instance_id: inst.id, healed, missed })
  return { healed, missed }
}

async function main(): Promise<void> {
  const instances = await listInstances()
  log.info('backfill.start', { instances: instances.length, filter: onlyInstance })
  let healed = 0
  let missed = 0
  for (const inst of instances) {
    const r = await backfillInstance(inst)
    healed += r.healed
    missed += r.missed
  }
  log.info('backfill.complete', { healed, missed })
  await pool.end()
}

main().catch((err) => {
  log.error('backfill.fatal', { error: err instanceof Error ? err.message : String(err) })
  process.exit(1)
})
